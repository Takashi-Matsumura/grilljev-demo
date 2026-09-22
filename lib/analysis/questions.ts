import type { JevQuestion } from "@/lib/jev";
import type { FlowModel } from "@/lib/model/types";
import { MAX_CHECKS_PER_REQUEST, type PendingCheck } from "./verify";

/** choice の特別な選択肢。定義した id 以外は返ってこないので、これで「該当なし」を表す。 */
export const NEW_ACTOR = "__new__";
export const UNKNOWN_ACTOR = "__unknown__";
export const NO_STEP = "__none__";
export const NO_ISSUE = "__none__";
export const NO_DUP_ACTOR = "__none__";

/** 検証質問の id。interpret が回答を引くときにも同じ規則を使う。 */
export const qFaithful = (stepId: string) => `faithful_${stepId}`;
export const qReadable = (stepId: string) => `readable_${stepId}`;
export const qActorDup = (actorId: string) => `actor_dup_${actorId}`;

/**
 * 検証の対象がまだ有効か。対象が消えた・文言が変わったものは検証しない（古い結果を当てない）。
 * アクターは、比べる相手（他のアクター）がいなければ聞けない。
 */
export function isLiveCheck(model: FlowModel, c: PendingCheck): boolean {
  if (c.kind === "label") {
    const s = model.steps.find((x) => x.id === c.stepId);
    return !!s && s.status !== "retracted" && s.label === c.label;
  }
  return model.actors.some((a) => a.id === c.actorId) && model.actors.length >= 2;
}

/** choice の選択肢が多すぎると遅く、精度も落ちる。直近だけに切る。 */
const MAX_STEP_OPTIONS = 40;
const MAX_RECENT_UTTERANCES = 3;

/**
 * Jev の state。**自由テキストが入るのは `utterance`（と直近の発話）だけ。**
 * それ以外は、業務名・アクター名・ステップ名といったフロー要素で、外部送信される。
 */
export type UtteranceState = {
  utterance: string;
  scope: { title: string; purpose: string };
  known_actors: { id: string; name: string; aliases: string[] }[];
  recent_steps: { id: string; from: string; to: string; label: string }[];
  open_issues: { id: string; question: string }[];
  recent_utterances: string[];
};

function activeSteps(model: FlowModel) {
  return model.steps.filter((s) => s.status !== "retracted").slice(-MAX_STEP_OPTIONS);
}

function openIssues(model: FlowModel) {
  return model.issues.filter((i) => i.status === "open" || i.status === "asked");
}

/** 参加者が答える文。ファシリテーターが実際に出した問いがあれば、それを使う。 */
export function issueText(issue: { question: string; prompt?: { text: string } }): string {
  return issue.prompt?.text ?? issue.question;
}

export function buildUtteranceState(
  model: FlowModel,
  utterance: string,
  recent: string[],
): UtteranceState {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  return {
    utterance,
    scope: { title: model.scope.title, purpose: model.scope.purpose },
    known_actors: model.actors.map((a) => ({ id: a.id, name: a.name, aliases: a.aliases })),
    recent_steps: activeSteps(model).map((s) => ({
      id: s.id,
      from: nameOf(s.from),
      to: nameOf(s.to),
      label: s.label,
    })),
    open_issues: openIssues(model).map((i) => ({ id: i.id, question: issueText(i) })),
    recent_utterances: recent.slice(-MAX_RECENT_UTTERANCES),
  };
}

/**
 * 発話 1 本につき 1 リクエストで聞く 16 問（既存の要素が無いと成立しない問は省く）。
 * 全質問は並列評価されるので、増やしてもレイテンシはほぼ変わらない。
 *
 * `instructions` と `criteria` の書き方が精度にそのまま効く（jev-demo の実測では、
 * 手がかりを criteria に入れるだけで言及確率が 0.31 → 0.97 になった）。
 */
export function buildUtteranceQuestions(
  model: FlowModel,
  checks: PendingCheck[] = [],
): Record<string, JevQuestion> {
  const title = model.scope.title || "（未設定）";

  const actorOptions: Record<string, string> = Object.fromEntries(
    model.actors.map((a) => [
      a.id,
      `${a.name}（${a.aliases.length > 0 ? a.aliases.join("・") : a.kind}）`,
    ]),
  );
  // 「新しい」と「分からない」を取り違えやすい（実測: 「顧客から営業に…」で、名前が出ているのに
  // 「分からない」を選んだ）。判断の軸は「発話に名前・呼称が出てくるか」。
  actorOptions[NEW_ACTOR] =
    "発話に具体的な名前・呼称（例: 顧客、部長、経理部、基幹システム）が出てくるが、上の既存の一覧のどれとも違う人物・部署・システム";
  actorOptions[UNKNOWN_ACTOR] =
    "発話に名前や呼称が全く出てこない（「送ります」「やります」のように主語や相手が省略されている）ため、誰なのか判断できない";

  const questions: Record<string, JevQuestion> = {
    // ── 関門: ここで落ちたら、以降の答えは使わない ─────────────────────
    chatter: {
      type: "noul",
      instructions: `この発話は、対象業務「${title}」の業務内容と無関係な雑談か`,
      criteria: {
        true: "挨拶、天気、雑談、機材の確認（音声が聞こえますか等）、休憩の相談、冗談など。業務の手順・担当・条件・目的のいずれにも触れていない",
        false: "業務の手順、担当者、条件、使うツール、目的、例外のいずれかに触れている。断片的でもよい",
      },
    },
    intent: {
      type: "choice",
      instructions: "この発話が、業務フロー図に対して果たしている役割はどれか",
      criteria: {
        describe_step: "誰かが誰かに何かをする、という手順を述べている",
        describe_condition: "「〜の場合は」「〜なら」といった条件による手順の違いを述べている",
        describe_actor: "登場人物・部署・システムそのものを説明・紹介している",
        describe_scope: "この業務全体の目的・対象範囲・きっかけ・頻度を述べている",
        correct_previous: "すでに図に描かれている内容を、訂正・否定している",
        answer_question: "ファシリテーターの問い（未解決の論点）に答えている",
        ask_question: "参加者が質問している（答えではない）",
        meta: "会議の進め方の相談など、業務内容そのものではない",
      },
    },
    specificity: {
      type: "score",
      instructions: "この発話だけで、シーケンス図に 1 本の矢印として描けるだけの具体性があるか",
      criteria: [
        "抽象的で、誰が何をするのか全く分からない",
        "方向性は分かるが、担当者か動作のどちらかが欠けている",
        "担当者と動作は分かるが、相手か成果物が曖昧",
        "誰が誰に何をするのかが明確",
        "誰が誰に何をどの手段でするのかまで明確",
      ],
    },

    // ── closed-set: Jev の本領。既存の要素を選択肢にする ─────────────────
    actor_from: {
      type: "choice",
      instructions:
        "この発話で述べられている動作を「行う側」は、次のうち誰か。発話に出てくる名前が一覧に無いときは、「判断できない」ではなく「新しい〜」を選ぶ",
      criteria: actorOptions,
    },
    actor_to: {
      type: "choice",
      instructions:
        "この発話で述べられている動作の「相手・受け手」は、次のうち誰か。誰にも渡さず、他の登場人物の成果物も対象にせず、自分の中だけで完結する作業のときに限り、行う側と同じものを選ぶ。他の登場人物が作ったものを確かめる・受け取る動作なら、その登場人物を選ぶ。発話に出てくる名前が一覧に無いときは、「判断できない」ではなく「新しい〜」を選ぶ",
      criteria: actorOptions,
    },
    message_kind: {
      type: "choice",
      instructions: "この発話が述べている動作の性質はどれか",
      criteria: {
        sync: "相手に依頼して、返事や結果を待つ",
        async: "相手に渡すだけで、返事を待たずに次へ進む",
        reply: "先行する依頼に対する返答・結果の返却",
        self: "誰かに渡さず、自分の持ち場の中で完結する作業",
      },
    },

    // ── 図の構造に効くフラグ ──────────────────────────────────────
    branch_marker: {
      type: "noul",
      instructions: "この発話は、場合分け（条件によって処理が変わること）を述べているか",
      criteria: {
        true: "「〜の場合は」「〜なら」「例外的に」など、条件で処理が分かれることを述べている",
        false: "条件分岐ではなく、常に行う手順を述べている",
      },
    },
    artifact_present: {
      type: "noul",
      instructions: "この発話に、具体的な書類・データ・システム・画面の名前が出てくるか",
      criteria: {
        true: "「請求書」「基幹システム」「Excel の台帳」など、具体的な成果物や道具の名前がある",
        false: "そうした具体名は出てこない",
      },
    },

    // ── ops-grill の掘り下げ軸を常時センサーとして回す ───────────────────
    exception_flag: {
      type: "noul",
      instructions: "この発話は、例外対応・イレギュラーな処理について述べているか",
      criteria: {
        true: "月末月初の特殊対応、トラブル時の処理、普段はやらない処理について述べている",
        false: "通常の処理について述べている",
      },
    },
    tacit_flag: {
      type: "noul",
      instructions: "この発話には、言語化されていない判断基準が含まれているか",
      criteria: {
        true: "「ケースバイケース」「経験で判断」「見れば分かる」など、基準が明示されていない判断が出てくる",
        false: "判断基準が明示されているか、そもそも判断が出てこない",
      },
    },
    person_dependent_flag: {
      type: "noul",
      instructions:
        "この発話は、特定の個人にしかできない処理・口頭で引き継がれている知識について述べているか",
      criteria: {
        true: "「◯◯さんしか分からない」「昔から口で伝えている」「私がやっている」など、属人化を示唆している",
        false: "そうした示唆はない",
      },
    },

    // ── 対象業務のズレ検知（段階 6 で使う。信号だけ先に取っておく） ─────────
    scope_drift: {
      type: "noul",
      instructions: `この発話は、現在の対象業務「${title}」の範囲の外の話か`,
      criteria: {
        true: "別の業務、または現在の業務を含むもっと大きな業務の話に移っている",
        false: "現在の対象業務の内側の話である",
      },
    },
    scope_relation: {
      type: "choice",
      instructions: `この発話の話題は、現在の対象業務「${title}」とどういう関係か`,
      criteria: {
        inside: "この業務の中の手順・登場人物・条件の話",
        sibling: "この業務とは別の、並列する業務の話",
        parent: "この業務を含む、もっと大きな業務の枠組みの話",
        child: "この業務の中の 1 ステップを、さらに細かく分解した作業の話",
        unrelated: "業務とは関係のない話",
      },
    },

    // ── 問いかけのタイミング（段階 5 で使う） ────────────────────────────
    grill_now: {
      type: "score",
      instructions: "今この瞬間に、ファシリテーターが参加者へ問いかけを挟むのは適切か",
      criteria: [
        "説明の途中で、遮ると流れが切れる",
        "まだ話が続きそうだ",
        "一区切りついたようにも見える",
        "話題が一段落し、次に何を話すか決まっていない",
        "明らかに詰まっている。誰かが導かないと進まない",
      ],
    },
  };

  // 既存のステップが無ければ「どれと同じか」は聞けない（選択肢が「該当なし」1 つになる）
  const steps = activeSteps(model);
  if (steps.length > 0) {
    const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
    questions.dup_step = {
      type: "choice",
      instructions:
        "この発話が述べている手順・内容は、すでに図に描かれている次のステップのどれかと同じことか。言い回しが違っても、同じ動作を指しているなら同じとみなす。ただし、誰から誰への動作か（向き）と、依頼か返答かが違うなら、別のステップである。すでに描かれたステップについての補足・コメント（やり方・道具・頻度・注意点）である場合は、そのステップを選ぶ。条件を述べたうえで、誰かが新しい動作をすると述べている場合は、補足ではなく別のステップである",
      criteria: {
        ...Object.fromEntries(
          steps.map((s) => [
            s.id,
            `${nameOf(s.from)} → ${nameOf(s.to)}（${s.kind === "reply" ? "返答" : "依頼・連絡"}）: ${s.label}`,
          ]),
        ),
        [NO_STEP]: "どのステップとも違う、新しい内容",
      },
    };
  }

  const issues = openIssues(model);
  if (issues.length > 0) {
    questions.answers_issue = {
      type: "choice",
      instructions: "この発話は、未解決になっている次の論点のどれかに答えているか",
      criteria: {
        ...Object.fromEntries(issues.map((i) => [i.id, issueText(i)])),
        [NO_ISSUE]: "どの論点への答えでもない",
      },
    };
  }

  // ── gemma が作った文言の検証（前の発話の分）。同じリクエストに相乗りさせる ──────
  for (const c of checks.filter((x) => isLiveCheck(model, x)).slice(-MAX_CHECKS_PER_REQUEST)) {
    if (c.kind === "label") {
      questions[qFaithful(c.stepId)] = {
        type: "noul",
        instructions: `発話「${c.source}」から、図の矢印の名前「${c.label}」を作った。この名前は、発話の内容だけでできているか（発話に無い情報が足されていないか）。発話の一部を取り出しただけで、主語や条件が省かれていても、足されていなければ「発話の内容だけ」とみなす`,
        criteria: {
          true: "名前の言葉と意味が、すべて発話の中にある。発話の一部を取り出した、短くまとめただけ、主語や条件を省いただけの場合を含む",
          false:
            "名前に、発話に無い担当者・手段・数値・条件が入っている。または発話と意味が違う",
        },
      };
      questions[qReadable(c.stepId)] = {
        type: "score",
        instructions: `「${c.label}」は、業務フロー図の矢印の名前としてどれくらい適切か`,
        criteria: [
          "意味が分からない",
          "冗長、または曖昧",
          "許容範囲",
          "簡潔で正確",
          "そのまま業務分掌に書ける",
        ],
      };
    } else {
      questions[qActorDup(c.actorId)] = {
        type: "choice",
        instructions: `新しく図に加えた登場人物「${c.name}」は、次のうち既存の誰かを、別の言い方で呼んでいるだけではないか`,
        criteria: {
          ...Object.fromEntries(
            model.actors
              .filter((a) => a.id !== c.actorId)
              .map((a) => [
                a.id,
                `${a.name}（${a.aliases.length > 0 ? a.aliases.join("・") : a.kind}）と同じ`,
              ]),
          ),
          [NO_DUP_ACTOR]: "既存のどれとも違う、本当に新しい登場人物",
        },
      };
    }
  }

  return questions;
}
