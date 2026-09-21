import type { JevAnswer, JevChoiceAnswer, JevNoulAnswer, JevQuestion } from "@/lib/jev";
import type { FlowModel } from "@/lib/model/types";
import type { ShiftRelation } from "./drift";

/**
 * 新しい業務名の選別。gemma が書いた候補の中から、jev が「いまの会話は何の業務の話か」を選ぶ。
 * 「現状のまま（新しい業務名は不要）」も選択肢に入れるので、jev は誤検知を止められる。純関数のみ。
 */

export type TitleCandidate = { id: string; title: string; reason: string };

export const KEEP = "keep";
/** 「範囲の外の話か」の下限。未満なら誤検知として提案しない */
export const MOVED_MIN = 0.5;
/**
 * pick で「現状のまま」に振られた確率がこれ以上なら、提案しない。
 * **どの業務名かの確信は見ない**: gemma の候補は「同じ新しい業務の言い換え」になりやすく、
 * 確率が割れるのは自然（実測: 0.46/0.29/0.21）。止めるべきかは「現状のままか」で決める。
 */
export const KEEP_MAX = 0.5;

const RELATION_TEXT: Record<ShiftRelation, string> = {
  sibling: "この業務とは別の、並列する業務",
  parent: "この業務を含む、もっと大きな業務の枠組み",
  child: "この業務の中の 1 ステップを、さらに細かく分解した作業",
};

export function buildShiftState(
  model: FlowModel,
  recent: string[],
  relation: ShiftRelation,
  candidates: TitleCandidate[],
) {
  return {
    current_scope: { title: model.scope.title, purpose: model.scope.purpose },
    suspected_relation: RELATION_TEXT[relation],
    recent_utterances: recent.slice(-4),
    candidates: candidates.map((c) => ({ id: c.id, title: c.title })),
  };
}

export function buildShiftQuestions(
  model: FlowModel,
  candidates: TitleCandidate[],
): Record<string, JevQuestion> {
  const title = model.scope.title || "（未設定）";
  return {
    moved: {
      type: "noul",
      instructions: `直近の発言は、現在の対象業務「${title}」の範囲の外の話か`,
      criteria: {
        true: "別の業務、または現在の業務を含むもっと大きな枠組み・細かい作業に話が移っている",
        false: "現在の対象業務の内側の話である",
      },
    },
    pick: {
      type: "choice",
      instructions:
        "直近の発言は、次のうちどの業務の話をしているか。現在の対象業務の範囲内なら「現状のまま」を選ぶ",
      criteria: {
        [KEEP]: `現在の対象業務「${title}」のまま。新しい業務名は不要`,
        ...Object.fromEntries(candidates.map((c) => [c.id, `${c.title}（${c.reason}）`])),
      },
    },
  };
}

export type ShiftDecision = {
  status: "propose" | "keep";
  chosen?: TitleCandidate;
  moved: number | null;
  summary: string;
};

type Answers = Record<string, JevAnswer | undefined>;

export function decideShift(answers: Answers, candidates: TitleCandidate[]): ShiftDecision {
  const movedAnswer = answers.moved as JevNoulAnswer | undefined;
  const moved = movedAnswer && movedAnswer.type === "noul" ? movedAnswer.noul : null;
  const pickAnswer = answers.pick;
  const pick = pickAnswer && pickAnswer.type === "choice" ? (pickAnswer as JevChoiceAnswer) : null;

  if (!pick) return { status: "keep", moved, summary: "jev の回答がないため提案しません" };

  const keepProb = pick.probabilities[KEEP] ?? (pick.choice === KEEP ? pick.confidence : 0);
  if (pick.choice === KEEP || keepProb >= KEEP_MAX) {
    return {
      status: "keep",
      moved,
      summary: `現状の対象業務のままと判断しました（「現状のまま」${keepProb.toFixed(2)}）`,
    };
  }
  if (moved !== null && moved < MOVED_MIN) {
    return {
      status: "keep",
      moved,
      summary: `範囲の外の話とは言えないため提案しません（範囲外 ${moved.toFixed(2)}）`,
    };
  }

  // 候補の中で最も確率の高いものを提案する（確率が割れていても、別の業務に移ったこと自体は明確）
  const chosen = [...candidates].sort(
    (a, b) => (pick.probabilities[b.id] ?? 0) - (pick.probabilities[a.id] ?? 0),
  )[0];
  if (!chosen) return { status: "keep", moved, summary: "業務名の候補がありません" };
  return {
    status: "propose",
    chosen,
    moved,
    summary: `「${chosen.title}」を提案します（選択 ${(pick.probabilities[chosen.id] ?? 0).toFixed(2)}・「現状のまま」${keepProb.toFixed(2)}${moved !== null ? `・範囲外 ${moved.toFixed(2)}` : ""}）`,
  };
}
