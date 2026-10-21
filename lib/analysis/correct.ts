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
 *
 * 上の決まった直し方に当てはまらないもの（渡すものを変える・前後に手順を足す・複数の直しを一度に言う）は
 * 「手直し」（edit）として、発言とそのステップを gemma に渡し、直す内容を決めさせる（後続処理）。
 *
 * 「いま直しているステップ」（focus）: 訂正で指したステップを覚えておき、番号を言わない続きの発言も
 * そのステップへの訂正として扱う。「4番について」で指すだけもでき、「OK」「以上です」で終える。
 * whisper が 1 つの話を途中で区切っても、番号を言い直さずに続けられる。
 */

const NONE = "__none__";

export type CorrectionAction =
  | "delete"
  | "change_from"
  | "change_to"
  | "swap"
  | "rename"
  | "edit"
  | "focus"
  | "release";

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

/** いま直しているステップ。消えた・見えないものは無いものとして扱う */
export function focusedStep(model: FlowModel, focusId: string | null | undefined): Step | null {
  if (!focusId) return null;
  return visibleSteps(model).find((s) => s.id === focusId) ?? null;
}

/** 訂正用の質問。ステップが 1 つも無ければ、直す対象が無いので聞かない */
export function buildCorrectionQuestions(
  model: FlowModel,
  focusId?: string | null,
): Record<string, JevQuestion> {
  const steps = stepOptions(model);
  if (Object.keys(steps).length === 0) return {};
  const focus = focusedStep(model, focusId);
  const focusNo = focus ? visibleSteps(model).indexOf(focus) + 1 : 0;
  const numbering =
    "図のステップには上から 1, 2, 3… と番号が振ってある。発話の「1番」「一番」「最初の」「いちばん上の」は 1 番、「2番」「二番目」は 2 番を指す" +
    (focus
      ? `。いまは ${focusNo} 番「${focus.label}」を直している最中で、番号を言わずに「そこ」「それ」「この手順」と言ったり、番号なしで直し方や前後に入る手順を話したりしたときは、${focusNo} 番を指す`
      : "");

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
        edit: "特定のステップを直すよう求めているが、上のどれにも当てはまらない、または複数の直しを一度に言っている（渡す書類・ファイルを変える、そのステップの前や後に別の手順が入ると言う、やり方を言い直す など。「4番で渡すのは請求書じゃなくてExcelのファイルです」「4番の前に、総務部がExcelに作り直す作業が入ります」）",
        focus: "特定のステップを指して、これから直すと言っているが、まだ直し方は言っていない（「4番について」「4番を直したいです」「4番のところですが」）",
        ...(focus
          ? {
              release:
                "いま直しているステップの話を終えると言っている（「OK」「以上です」「それで大丈夫です」「そこはそれでいいです」）",
            }
          : {}),
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
  /** 名前の言い直し・手直し。新しい名前や直す内容は gemma が発言から決める */
  followUps?: { kind: "rename" | "edit"; stepId: string }[];
  /** いま直しているステップを、この id に切り替える。null で終える。undefined なら変えない */
  focus?: string | null;
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
 * 手直しを終える発言か（「OK」「以上です」）。短い相づちは雑談に見えやすい
 * （実測: 「OK、以上です」が雑談 0.58 で落ちた）ので、雑談の判定より先に見る。
 */
export function interpretRelease(answers: Answers, model: FlowModel, focusId?: string | null): Correction | null {
  const focus = focusedStep(model, focusId);
  const action = choice(answers, "correction_action");
  if (!focus || action?.choice !== "release" || action.confidence < CORRECTION_MIN) return null;
  const no = visibleSteps(model).indexOf(focus) + 1;
  return { ops: [], focus: null, note: `${circled(no)}「${focus.label}」の手直しを終えました` };
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
  focusId?: string | null,
): Correction | null {
  const steps = visibleSteps(model);
  const numberOf = (s: Step) => steps.indexOf(s) + 1;
  const labelOf = (s: Step) => `${circled(numberOf(s))}「${s.label}」`;
  const focus = focusedStep(model, focusId);

  const action = choice(answers, "correction_action");
  const acting =
    action !== null &&
    action.choice !== NONE &&
    (action.confidence >= CORRECTION_STRONG || (intent === "correct_previous" && action.confidence >= CORRECTION_MIN));
  if (!acting) {
    if (intent !== "correct_previous") return null;
    // 直しているステップがあれば、直し方が決まった種類に当てはまらなくても gemma に任せる
    // （whisper が区切った話の切れ端でも、前の発言とつなげて読ませる）
    return focus
      ? {
          ops: [],
          followUps: [{ kind: "edit", stepId: focus.id }],
          focus: focus.id,
          note: `訂正: ${labelOf(focus)}を、発言に合わせて直します`,
        }
      : { ops: [], note: `訂正の発言ですが、どう直すかを特定できませんでした${UNRESOLVED}` };
  }

  const kind = action.choice as CorrectionAction;
  if (kind === "release") {
    return focus
      ? { ops: [], focus: null, note: `${labelOf(focus)}の手直しを終えました` }
      : { ops: [], note: "直しているステップはありません" };
  }

  const pick = (key: string): Step | null => {
    const c = choice(answers, key);
    if (!c || c.choice === NONE || c.confidence < CORRECTION_MIN) return null;
    return steps.find((s) => s.id === c.choice) ?? null;
  };
  // 番号を言わない続きの発言は、いま直しているステップを指す
  const target = pick("correction_target") ?? focus;
  if (!target) return { ops: [], note: `訂正の発言ですが、どのステップかを特定できませんでした${UNRESOLVED}` };
  const label = labelOf(target);
  // 直したステップを「いま直しているステップ」にする（続けて番号なしで直せる）。消したら終える
  const done = (c: Correction): Correction => ({ ...c, focus: kind === "delete" ? null : target.id });

  switch (kind) {
    case "focus":
      return done({
        ops: [],
        note: `${label}を直します。番号を言わずに直し方を話してください（終わったら「OK」）`,
      });

    case "edit":
      return done({
        ops: [],
        followUps: [{ kind: "edit", stepId: target.id }],
        note: `訂正: ${label}を、発言に合わせて直します`,
      });

    case "delete":
      return done({ ops: [{ op: "step.retract", id: target.id }], note: `訂正: ${label}を消しました` });

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
        return done({ ops: [], note: `訂正の発言ですが、${label}の正しい${role}を特定できませんでした${UNRESOLVED}` });
      }
      return done({
        ops: [{ op: "step.update", id: target.id, patch: { [side]: actor.id } }],
        note: `訂正: ${label}の${role}を「${actor.name}」に直しました`,
      });
    }

    case "rename":
      return done({
        ops: [],
        followUps: [{ kind: "rename", stepId: target.id }],
        note: `訂正: ${label}の名前を、発言の言い方に直します`,
      });

    case "swap": {
      // Jev の答えが対象と同じ・確信不足なら、発話に出てきたもう一方の番号で補う
      const picked = pick("correction_other");
      const spoken = numbersIn(utterance)
        .map((n) => steps[n - 1])
        .find((s) => s !== undefined && s.id !== target.id);
      const other = picked && picked.id !== target.id ? picked : (spoken ?? null);
      if (!other || other.id === target.id) {
        return done({ ops: [], note: `訂正の発言ですが、${label}と入れ替える相手を特定できませんでした${UNRESOLVED}` });
      }
      return done({
        ops: [
          { op: "step.update", id: target.id, patch: { order: other.order } },
          { op: "step.update", id: other.id, patch: { order: target.order } },
        ],
        note: `訂正: ${label}と${circled(numberOf(other))}「${other.label}」の順番を入れ替えました`,
      });
    }

    default:
      return null;
  }
}
