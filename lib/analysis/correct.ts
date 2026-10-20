import type { JevAnswer, JevChoiceAnswer, JevQuestion } from "@/lib/jev";
import type { FlowModel, ModelOp, Step } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";
import { ACTOR_APPLY, CORRECTION_MIN, CORRECTION_STRONG } from "./thresholds";

/**
 * 音声による図の訂正（「1 番を消して」「2 番の相手は経理です」「2 番と 3 番を入れ替えて」「1 番の名前は〇〇です」）。
 *
 * 発話ごとの Jev のリクエストに、訂正用の質問を相乗りさせる（並列評価なので待ち時間はほぼ増えない）。
 * 対象のステップは、図に描かれている番号（autonumber）を付けた選択肢から選ばせる。
 * 名前の言い直しは、新しい名前を発言から取り出すのに gemma が要るので、後続処理（followUps）に回す。
 */

const NONE = "__none__";

export type CorrectionAction = "delete" | "change_from" | "change_to" | "swap" | "rename";

const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}番`);

/** 図の番号つきの選択肢。番号は図の autonumber と同じ（描画対象のステップの並び順） */
function stepOptions(model: FlowModel): Record<string, string> {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  return Object.fromEntries(
    visibleSteps(model).map((s, i) => [
      s.id,
      `${i + 1}番: ${nameOf(s.from)} → ${nameOf(s.to)}: ${s.label}`,
    ]),
  );
}

/** 訂正用の質問。ステップが 1 つも無ければ、直す対象が無いので聞かない */
export function buildCorrectionQuestions(model: FlowModel): Record<string, JevQuestion> {
  const steps = stepOptions(model);
  if (Object.keys(steps).length === 0) return {};
  const numbering =
    "図のステップには上から 1, 2, 3… と番号が振ってある。発話の「1番」「一番」「最初の」「いちばん上の」は 1 番、「2番」「二番目」は 2 番を指す";

  return {
    correction_action: {
      type: "choice",
      instructions: `この発話は、すでに図に描かれているステップを直すよう求めているか。求めているなら、どう直すのか。${numbering}`,
      criteria: {
        delete: "特定のステップを消す・取り消す・無かったことにするよう求めている（「1番を消して」「受け取るのところは要らない」）",
        change_from: "特定のステップを行う人（送り手）が違うと言い、正しい人を述べている（「2番をやるのは総務じゃなくて営業です」）",
        change_to: "特定のステップの相手（受け手）が違うと言い、正しい相手を述べている（「2番の送り先は経理です」）",
        swap: "2 つのステップの順番を入れ替える・前後を直すよう求めている（「2番と3番が逆です」）",
        rename: "特定のステップの名前（矢印に書かれた文言）を、新しい言い方に直すよう求めている（「1番の名前は請求書の受付です」「2番はPDFを転送するに直して」）",
        [NONE]: "図の既存のステップを直す発言ではない（新しい手順の説明、既存の手順への補足、質問、雑談など）",
      },
    },
    correction_target: {
      type: "choice",
      instructions: `直す対象として発話が指しているステップはどれか。入れ替えなら、先に言われた方。${numbering}`,
      criteria: { ...steps, [NONE]: "どのステップも指していない、または特定できない" },
    },
    correction_other: {
      type: "choice",
      instructions: `順番を入れ替える発話なら、入れ替える相手のステップはどれか（後に言われた方）。${numbering}`,
      criteria: { ...steps, [NONE]: "入れ替えの話ではない、または相手が特定できない" },
    },
    correction_actor: {
      type: "choice",
      instructions: "送り手・受け手を直す発話なら、正しいとされている人・部署・システムは次のうち誰か",
      criteria: {
        ...Object.fromEntries(model.actors.map((a) => [a.id, a.name])),
        [NONE]: "正しい人が発話に出てこない、または上の一覧にいない",
      },
    },
  };
}

type Answers = Record<string, JevAnswer | undefined>;

const choice = (a: Answers, key: string): JevChoiceAnswer | null => {
  const v = a[key];
  return v && v.type === "choice" ? v : null;
};

export type Correction = {
  ops: ModelOp[];
  /** 名前の言い直し。新しい名前は gemma が発言から取り出す */
  followUps?: { kind: "rename"; stepId: string }[];
  /** 画面に出す 1 行。直せなかったときは、その理由とマウスでの直し方 */
  note: string;
};

const UNRESOLVED = "（図の番号をクリックすると、手で直せます）";

const KANJI_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」→ 12。十の位と一の位だけ（図の番号は大きくならない） */
function kanjiNumber(s: string): number {
  const [tens, ones] = s.includes("十") ? s.split("十") : ["", s];
  const t = s.includes("十") ? (tens === "" ? 1 : (KANJI_DIGIT[tens] ?? 0)) : 0;
  return t * 10 + (ones === "" ? 0 : (KANJI_DIGIT[ones] ?? 0));
}

/**
 * 発話に出てくる「◯番」の番号を、出てきた順に返す（「2番と3番」→ [2, 3]、「一番」→ [1]）。
 * 入れ替えの相手を Jev が取り違える（実測: 「2番と3番の順番が逆です」で、相手にも 2 番を選んだ）ので、
 * 発話に番号が 2 つ出ていれば、それで補う。
 */
export function numbersIn(utterance: string): number[] {
  const half = utterance.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  return [...half.matchAll(/([0-9]+|[一二三四五六七八九十]+)\s*(?:番|つ目)/g)]
    .map((m) => (/^[0-9]+$/.test(m[1]) ? Number(m[1]) : kanjiNumber(m[1])))
    .filter((n) => n > 0);
}

/**
 * 訂正の回答 → 図の変更。訂正の発言でなければ null（通常の解釈に進む）。
 *
 * 訂正と見なすのは、intent が「訂正」のとき、または訂正の質問が強い確信で「直す」と答えたとき
 * （実測: 「一番の受け取りを消してください」が intent では訂正と判定されなかった）。
 * 対象や相手の確信が足りなければ、図は変えずに理由だけ返す（誤って別のステップを消さない）。
 */
export function interpretCorrection(
  answers: Answers,
  model: FlowModel,
  intent: string,
  utterance: string,
): Correction | null {
  const action = choice(answers, "correction_action");
  const acting =
    action !== null &&
    action.choice !== NONE &&
    (action.confidence >= CORRECTION_STRONG || (intent === "correct_previous" && action.confidence >= CORRECTION_MIN));
  if (!acting) {
    return intent === "correct_previous"
      ? { ops: [], note: `訂正の発言ですが、どう直すかを特定できませんでした${UNRESOLVED}` }
      : null;
  }

  const steps = visibleSteps(model);
  const numberOf = (s: Step) => steps.indexOf(s) + 1;
  const pick = (key: string): Step | null => {
    const c = choice(answers, key);
    if (!c || c.choice === NONE || c.confidence < CORRECTION_MIN) return null;
    return steps.find((s) => s.id === c.choice) ?? null;
  };
  const target = pick("correction_target");
  if (!target) return { ops: [], note: `訂正の発言ですが、どのステップかを特定できませんでした${UNRESOLVED}` };
  const label = `${circled(numberOf(target))}「${target.label}」`;
  const kind = action.choice as CorrectionAction;

  switch (kind) {
    case "delete":
      return { ops: [{ op: "step.retract", id: target.id }], note: `訂正: ${label}を消しました` };

    case "change_from":
    case "change_to": {
      const who = choice(answers, "correction_actor");
      const actor =
        who && who.choice !== NONE && who.confidence >= ACTOR_APPLY
          ? model.actors.find((a) => a.id === who.choice)
          : undefined;
      const side = kind === "change_from" ? "from" : "to";
      const role = side === "from" ? "行う側" : "相手";
      if (!actor || actor.id === target[side]) {
        return { ops: [], note: `訂正の発言ですが、${label}の正しい${role}を特定できませんでした${UNRESOLVED}` };
      }
      return {
        ops: [{ op: "step.update", id: target.id, patch: { [side]: actor.id } }],
        note: `訂正: ${label}の${role}を「${actor.name}」に直しました`,
      };
    }

    case "rename":
      return {
        ops: [],
        followUps: [{ kind: "rename", stepId: target.id }],
        note: `訂正: ${label}の名前を、発言の言い方に直します`,
      };

    case "swap": {
      // Jev の答えが対象と同じ・確信不足なら、発話に出てきたもう一方の番号で補う
      const picked = pick("correction_other");
      const spoken = numbersIn(utterance)
        .map((n) => steps[n - 1])
        .find((s) => s !== undefined && s.id !== target.id);
      const other = picked && picked.id !== target.id ? picked : (spoken ?? null);
      if (!other || other.id === target.id) {
        return { ops: [], note: `訂正の発言ですが、${label}と入れ替える相手を特定できませんでした${UNRESOLVED}` };
      }
      return {
        ops: [
          { op: "step.update", id: target.id, patch: { order: other.order } },
          { op: "step.update", id: other.id, patch: { order: target.order } },
        ],
        note: `訂正: ${label}と${circled(numberOf(other))}「${other.label}」の順番を入れ替えました`,
      };
    }

    default:
      return null;
  }
}
