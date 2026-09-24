import type { ModelOp, NewStep, StepFlags } from "@/lib/model/types";

/**
 * 開発用のサンプル会議。マイクなしで「文字起こし → 図が育つ」を再現するための台本。
 *
 * **これは Jev の判定結果ではなく、人が書いた台本。** 雑談か業務かも、どのアクターが
 * 動作の主体かも、ここに固定で書いてある。段階 3 で Jev の判定に置き換わったとき、
 * 同じ台詞に対して同じ図が出るかを見る比較の基準としても使える。
 *
 * 初期設定の関係部署は 営業・与信部 の 2 つだけ（A1=営業 / A2=与信部）。
 * 顧客（A3）と部長（A4）は会話の中で初めて登場する。台本モードでは actor.add で足し、
 * Jev モードでは Jev が「新しい登場人物」と判定して gemma が名前を特定する。
 * どちらも、出現順に A3・A4 と採番されるので id は一致する。
 */

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
 * 「このアプリの仕組み」を業務に見立てた台本（セルフ検証用）。
 * 社内検証環境の構成、つまり**判定をローカルの DiffusionGemma で行う経路**を書いてある
 * （ブラウザ → サーバー → whisper / DiffusionGemma / gemma → ブラウザ → Mermaid）。
 * 1 発話 1 動作。1 文に「誰が誰に何をする」を 1 つだけ入れるのが、判定器に
 * 送り手・受け手を取り違えさせないコツ。
 *
 * 登場する 2 つの Gemma は**別のモデル**で、役割も違う。台本はそこを明示的に言わせている:
 *   - DiffusionGemma（26B-A4B の MoE・拡散モデル）= 判定。選択肢から選び、確率を返す
 *   - gemma（Gemma 4 12B instruct・llama.cpp）    = 生成。短い文言を書く
 *
 * 台本モード用の固定 ops は持たない — **判定器を通して実行する専用**。期待値（kind）は
 * 人が付けた目安で、判定器の答えとの一致・不一致を見るためのもの。
 */
const line = (id: string, kind: SampleEntry["kind"], text: string): SampleEntry => ({ id, text, kind, ops: [] });

export const APP_SCENARIO: SampleEntry[] = [
  line("a01", "chatter", "はい、では録画も回っているので始めましょう。"),
  line("a02", "business", "この仕組みの目的は、会議中の発言から、その場で業務フロー図を作ることです。"),
  // ── 音声 → 文字（whisper） ──
  line("a03", "business", "まず、ブラウザがマイクの音声を区切って、サーバーに送ります。"),
  line("a04", "business", "サーバーは、その音声を whisper に渡して、文字起こしを依頼します。"),
  line("a05", "business", "whisper は、日本語の文字に起こして、サーバーに返します。"),
  line("a06", "chatter", "あ、コーヒーのおかわり取ってきてもいいですか？"),
  line("a07", "business", "サーバーは、文字から定型の誤認識を取り除いて、ブラウザに返します。"),
  // ── 文字 → 判定（DiffusionGemma） ──
  line("a08", "business", "ブラウザは、その文字と図の現状を、サーバーに送って判定を依頼します。"),
  line("a09", "business", "サーバーは、質問を 16 個まとめて DiffusionGemma に送ります。"),
  line("a10", "business", "DiffusionGemma は、それぞれの質問に確率で答えて、サーバーに返します。"),
  line("a11", "business", "サーバーは、確率を閾値と比べて図への変更の一覧に直し、ブラウザに渡します。"),
  // ── 変更の適用（分岐: 雑談 / 業務の話） ──
  line("a12", "business", "判定が雑談なら、ブラウザは、その発言を図に入れずに捨てます。"),
  line("a13", "business", "業務の話なら、ブラウザは変更の一覧を図のデータに反映します。"),
  // ── ステップ名（gemma） ──
  line("a14", "business", "反映したあと、ブラウザは、ステップの名前を作るようにサーバーに頼みます。"),
  line("a15", "business", "サーバーは、gemma に名前を書くよう依頼します。"),
  line("a16", "business", "gemma は、名前を書いて、サーバーに返します。"),
  line("a17", "chatter", "すみません、少し窓を開けてもいいですか。暑くなってきました。"),
  // 「gemma の名前」だと「gemma という名前」とも読めて雑談に倒れる（実測）。主語と目的語を明示する
  line("a18", "business", "サーバーは、gemma が書いた名前を、ブラウザに渡します。"),
  line("a19", "business", "ブラウザは、ステップの名前を、届いた名前に差し替えます。"),
  line("a20", "business", "次の発言のとき、サーバーは、その名前の検証を DiffusionGemma の質問に加えて送ります。"),
  line("a21", "business", "ブラウザは、確信が低いステップを点線の仮ステップにして、承認を待ちます。"),
  // ── 図の描画（Mermaid） ──
  line("a22", "business", "ブラウザは、図のデータから Mermaid のコードを書いて、Mermaid に渡します。"),
  line("a23", "business", "Mermaid は、そのコードから図の絵を描いて、ブラウザに返します。"),
  line("a24", "business", "図のデータを間に挟むのは、あとから取り消しや割り込みをできるようにするためです。"),
];
