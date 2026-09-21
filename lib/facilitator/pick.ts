import type { JevAnswer, JevChoiceAnswer, JevNoulAnswer, JevQuestion } from "@/lib/jev";
import type { FlowModel, IssueKind } from "@/lib/model/types";

/**
 * 問いの選別。gemma が書いた候補のうち「いま出すべき 1 問」を jev に選ばせる。
 * 生成はローカル、選別は jev という役割分担（gemma は問いを書けるが、いま出すべきかを
 * 確率つきで判断するのは jev の得意分野）。純関数のみ。
 */

export type Candidate = {
  id: string;
  kind: IssueKind;
  text: string;
  /** 推奨回答（会話から推測できる範囲の仮の答え）。無ければ空 */
  suggested: string;
  /** 既存の未解決の論点を言い換えたものなら、その id */
  issueId: string | null;
};

/** 「いま質問を投げてよいか」の下限。未満なら黙る（議論が乗っているときに割り込まない） */
export const ASK_NOW_MIN = 0.5;
/** 会話や図に根拠がある問いか。未満は gemma の作り話として捨てる */
export const GROUNDED_MIN = 0.5;
/** すでに答えが出ている問いか。以上なら捨てる */
export const ANSWERED_MAX = 0.5;
/** pick の confidence がこれ未満なら、どれも決め手に欠けるので何も出さない（沈黙する勇気） */
export const PICK_CONFIDENT = 0.4;

const MAX_STEPS_IN_STATE = 8;

export type PickState = {
  scope: { title: string; purpose: string };
  /** 最後の発言から何秒経ったか。議論が続いているか（割り込んでよいか）の判断材料。不明なら null */
  seconds_since_last_utterance: number | null;
  recent_utterances: string[];
  recent_steps: string[];
  open_issues: string[];
  candidates: { id: string; text: string }[];
};

export function buildPickState(
  model: FlowModel,
  recent: string[],
  candidates: Candidate[],
  silenceSec: number | null = null,
): PickState {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  return {
    scope: { title: model.scope.title, purpose: model.scope.purpose },
    seconds_since_last_utterance: silenceSec === null ? null : Math.round(silenceSec),
    recent_utterances: recent.slice(-6),
    recent_steps: model.steps
      .filter((s) => s.status !== "retracted")
      .sort((a, b) => a.order - b.order)
      .slice(-MAX_STEPS_IN_STATE)
      .map((s) => `${nameOf(s.from)}→${nameOf(s.to)}: ${s.label}`),
    open_issues: model.issues
      .filter((i) => i.status === "open")
      .map((i) => i.prompt?.text ?? i.question),
    candidates: candidates.map((c) => ({ id: c.id, text: c.text })),
  };
}

const qGrounded = (id: string) => `${id}_grounded`;
const qAnswered = (id: string) => `${id}_answered`;

/** 候補 n 件 × 2 問 + pick + should_ask_now を 1 リクエストに詰める（並列評価される）。 */
export function buildPickQuestions(candidates: Candidate[]): Record<string, JevQuestion> {
  const q: Record<string, JevQuestion> = {
    should_ask_now: {
      type: "noul",
      instructions:
        "いま参加者に質問を投げるべきか。state の seconds_since_last_utterance（最後の発言からの秒数）と直近の発言から判断する。数秒以内に発言があって議論が続いているなら、割り込むと流れを切るので黙っているべき。十分に間が空いている、または話題が一巡したなら、投げてよい",
      criteria: {
        true: "最後の発言から十分な間が空いている、話題が一巡した、または図に明らかな空白があって次に何を話すか決まっていない",
        false: "最後の発言から数秒以内で、参加者が具体的な話を続けている最中。割り込むと流れを切る",
      },
    },
    pick: {
      type: "choice",
      instructions:
        "会議を前に進めるために、今まさに出すべき問いはどれか。図の空白を埋め、かつ参加者がその場で答えられるものを選ぶ",
      criteria: Object.fromEntries(candidates.map((c) => [c.id, c.text])),
    },
  };
  for (const c of candidates) {
    q[qGrounded(c.id)] = {
      type: "noul",
      instructions: `この問い「${c.text}」は、実際に会話や図に出てきた内容に基づいているか`,
      criteria: {
        true: "会話や図に出てきた人・ステップ・言葉を踏まえている",
        false: "会話に出ていない事柄を前提にしている。話を作っている",
      },
    };
    q[qAnswered(c.id)] = {
      type: "noul",
      instructions: `この問い「${c.text}」は、これまでの会話や図ですでに答えが出ているか`,
      criteria: {
        true: "会話の中で明示的に、または明らかに含意される形で答えが出ている",
        false: "まだ答えが出ていない",
      },
    };
  }
  return q;
}

export type PickReason = {
  id: string;
  grounded: number | null;
  answered: number | null;
  probability: number | null;
  /** 捨てた理由。採用候補・比較対象なら空 */
  dropped?: "ungrounded" | "answered" | "no_answer";
};

export type PickDecision = {
  /** ask=出す / hold=いまは黙る（あとで再判定） / none=出せる候補が無い */
  status: "ask" | "hold" | "none";
  chosen?: Candidate;
  reasons: PickReason[];
  summary: string;
  askNow: number | null;
};

type Answers = Record<string, JevAnswer | undefined>;

const noul = (a: Answers, key: string): number | null => {
  const v = a[key] as JevNoulAnswer | undefined;
  return v && v.type === "noul" ? v.noul : null;
};
const choice = (a: Answers, key: string): JevChoiceAnswer | null => {
  const v = a[key];
  return v && v.type === "choice" ? v : null;
};
const fmt = (n: number) => n.toFixed(2);

export function decidePick(
  answers: Answers,
  candidates: Candidate[],
  opts: { force: boolean },
): PickDecision {
  const askNow = noul(answers, "should_ask_now");
  const pick = choice(answers, "pick");

  const reasons: PickReason[] = candidates.map((c) => {
    const grounded = noul(answers, qGrounded(c.id));
    const answered = noul(answers, qAnswered(c.id));
    const probability = pick?.probabilities[c.id] ?? null;
    let dropped: PickReason["dropped"];
    if (grounded === null || answered === null) dropped = "no_answer";
    else if (grounded < GROUNDED_MIN) dropped = "ungrounded";
    else if (answered >= ANSWERED_MAX) dropped = "answered";
    return { id: c.id, grounded, answered, probability, dropped };
  });

  // 手動で「出して」と頼まれたときは、間合いの判断（should_ask_now）は無視する
  if (!opts.force && (askNow === null || askNow < ASK_NOW_MIN)) {
    return {
      status: "hold",
      reasons,
      askNow,
      summary: `いまは割り込まず様子を見ます（出すべき度合い ${askNow === null ? "不明" : fmt(askNow)}）`,
    };
  }

  const eligible = candidates.filter((c) => !reasons.find((r) => r.id === c.id)?.dropped);
  if (eligible.length === 0) {
    const why = reasons.map((r) => `${r.id}:${r.dropped ?? "ok"}`).join(" ");
    return {
      status: "none",
      reasons,
      askNow,
      summary: `出せる候補がありません（根拠なし・回答済みなどで全て除外: ${why}）`,
    };
  }

  const best = [...eligible].sort(
    (a, b) => (pick?.probabilities[b.id] ?? 0) - (pick?.probabilities[a.id] ?? 0),
  )[0];
  // 決め手に欠けるなら何も出さない（1 度に 1 問・沈黙する勇気）。
  // ただし人が「出して」と頼んだ（force）ときは、確信が低くても最有力を出す（頼んだのに何も出ない、を避ける）。
  if (!pick || (!opts.force && pick.confidence < PICK_CONFIDENT && eligible.length > 1)) {
    return {
      status: "none",
      reasons,
      askNow,
      summary: `どの問いも決め手に欠けるため出しません（確信 ${pick ? fmt(pick.confidence) : "不明"}）`,
    };
  }
  return {
    status: "ask",
    chosen: best,
    reasons,
    askNow,
    summary: `「${best.text}」を選びました（選択確率 ${fmt(pick.probabilities[best.id] ?? 0)}）`,
  };
}
