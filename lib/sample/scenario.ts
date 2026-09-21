import type { ModelOp, NewStep, StepFlags } from "@/lib/model/types";

/**
 * 開発用のサンプル会議。マイクなしで「文字起こし → 図が育つ」を再現するための台本。
 *
 * **これは jev の判定結果ではなく、人が書いた台本。** 雑談か業務かも、どのアクターが
 * 動作の主体かも、ここに固定で書いてある。段階 3 で jev の判定に置き換わったとき、
 * 同じ台詞に対して同じ図が出るかを見る比較の基準としても使える。
 *
 * 初期設定の関係部署は 営業・与信部 の 2 つだけ（A1=営業 / A2=与信部）。
 * 顧客（A3）と部長（A4）は会話の中で初めて登場する。台本モードでは actor.add で足し、
 * jev モードでは jev が「新しい登場人物」と判定して gemma が名前を特定する。
 * どちらも、出現順に A3・A4 と採番されるので id は一致する。
 */

export const SAMPLE_SCOPE = {
  title: "与信照会つき見積作成",
  departments: ["営業", "与信部"],
} as const;

export type SampleEntry = {
  id: string;
  text: string;
  kind: "chatter" | "business";
  /** 図に対する変更。雑談は空 */
  ops: ModelOp[];
};

function step(
  id: string,
  order: number,
  from: string,
  to: string,
  label: string,
  sourceId: string,
  opts: {
    kind?: NewStep["kind"];
    branchId?: string;
    confidence?: number;
    status?: NewStep["status"];
    flags?: StepFlags;
  } = {},
): ModelOp {
  return {
    op: "step.add",
    step: {
      id,
      from,
      to,
      label,
      kind: opts.kind ?? "sync",
      branchId: opts.branchId ?? null,
      order,
      confidence: opts.confidence ?? 0.9,
      status: opts.status ?? "confirmed",
      flags: opts.flags ?? {},
      sourceUtteranceIds: [sourceId],
    },
  };
}

export const SAMPLE_SCENARIO: SampleEntry[] = [
  {
    id: "u01",
    text: "はい、それでは始めましょう。音声は聞こえていますか？",
    kind: "chatter",
    ops: [],
  },
  {
    id: "u02",
    text: "この業務の目的は、与信リスクのある取引を避けつつ、見積を素早く返すことです。",
    kind: "business",
    ops: [{ op: "scope.set", patch: { purpose: "与信リスクのある取引を避けつつ、見積を素早く返す" } }],
  },
  {
    id: "u03",
    text: "まず、顧客から営業に見積の依頼が来ます。",
    kind: "business",
    ops: [
      { op: "actor.add", actor: { id: "A3", name: "顧客", kind: "external", aliases: [] } },
      step("S1", 1, "A3", "A1", "見積を依頼する", "u03"),
    ],
  },
  {
    id: "u04",
    text: "営業は、与信部に与信照会をかけます。",
    kind: "business",
    ops: [step("S2", 2, "A1", "A2", "与信照会をかける", "u04")],
  },
  {
    id: "u05",
    text: "あ、そういえば昨日の野球、見ました？",
    kind: "chatter",
    ops: [],
  },
  {
    id: "u06",
    text: "与信部は、可否を営業に回答します。",
    kind: "business",
    ops: [step("S3", 3, "A2", "A1", "可否を回答する", "u06", { kind: "reply" })],
  },
  {
    id: "u07",
    text: "与信がOKなら、営業が顧客に見積を提示します。",
    kind: "business",
    ops: [
      { op: "branch.add", branch: { id: "B1", kind: "alt", condition: "与信OK", groupId: "G1", index: 0 } },
      step("S4", 4, "A1", "A3", "見積を提示する", "u07", { branchId: "B1" }),
    ],
  },
  {
    id: "u08",
    text: "NGの場合は、営業が顧客にお断りの連絡をします。",
    kind: "business",
    ops: [
      { op: "branch.add", branch: { id: "B2", kind: "alt", condition: "与信NG", groupId: "G1", index: 1 } },
      step("S5", 5, "A1", "A3", "見積不可を連絡する", "u08", { branchId: "B2" }),
    ],
  },
  {
    id: "u09",
    text: "高額のときは、ケースバイケースで部長が判断してますね。",
    kind: "business",
    ops: [
      { op: "actor.add", actor: { id: "A4", name: "部長", kind: "role", aliases: [] } },
      // 「誰が誰に」が曖昧なので確信度は低く、仮ステップにする。
      // order 3.5 は S3 と S4 の間への割り込み（実数 order の実演）。
      step("S6", 3.5, "A1", "A4", "高額案件の判断を仰ぐ", "u09", {
        confidence: 0.42,
        status: "provisional",
        flags: { tacit: true },
      }),
      {
        op: "issue.add",
        issue: {
          id: "I1",
          question: "「高額」とは、いくらからですか？",
          kind: "criteria",
          relatedStepIds: ["S6"],
          status: "open",
          prompt: {
            text: "部長の判断が入る「高額」の基準は、金額のしきい値として決まっていますか？",
            suggestedAnswer: "決まっていないなら、まず過去の判断例から目安を洗い出す",
          },
        },
      },
    ],
  },
  {
    id: "u10",
    text: "その与信の判断は、実は田中さんにしか分からないんですよね。",
    kind: "business",
    ops: [
      { op: "step.update", id: "S3", patch: { flags: { personDependent: true } } },
      {
        op: "issue.add",
        issue: {
          id: "I2",
          question: "田中さん以外が与信判断できるようにするには？",
          kind: "who",
          relatedStepIds: ["S3"],
          status: "open",
        },
      },
    ],
  },
  {
    id: "u11",
    text: "ちょっと休憩にしましょうか。",
    kind: "chatter",
    ops: [],
  },
];

/**
 * 話題が別の業務（請求書の発行）へ移る場面。対象業務のズレの検知を試すための続き。
 * **jev モードでだけ意味がある**（ズレを判定するのは jev）。台本モードでは図は変わらない（ops なし）。
 */
export const SAMPLE_SHIFT_SCENARIO: SampleEntry[] = [
  {
    id: "u12",
    text: "ところで、話は変わりますが、月末の請求書発行の話もしていいですか？",
    kind: "business",
    ops: [],
  },
  {
    id: "u13",
    text: "毎月末に、経理が基幹システムから請求データを出力します。",
    kind: "business",
    ops: [],
  },
  {
    id: "u14",
    text: "出力したデータは、経理が営業に確認してもらいます。",
    kind: "business",
    ops: [],
  },
  {
    id: "u15",
    text: "確認が済んだら、経理が請求書を顧客に発送します。",
    kind: "business",
    ops: [],
  },
];
