import type { ActorKind } from "@/lib/model/types";

/**
 * 開発用のサンプル会議。マイクなしで「文字起こし → 図が育つ」を再現するための台本。
 *
 * 台本が持つのは**発話の文と、人が付けた期待値（雑談か業務か）だけ**。図への変更は
 * 持たない。流すと実際に判定器（既定はローカルの DiffusionGemma）を呼び、その答えで
 * 図が育つ。期待値は「台本と一致 / 不一致」の表示に使うだけで、判定には影響しない。
 *
 * 台本ごとに、前提にしている登場人物を ACTORS で宣言する。会議を作るときに関係部署へ
 * 入れておかないと、判定器が新しいライフラインを立てられず、既存ステップの重複と
 * 見なして落としてしまう（実測）。足りないときは画面で知らせ、1 クリックで足せる。
 */

export type SampleEntry = {
  id: string;
  /** 発話。文字起こしの 1 行として流す */
  text: string;
  /** 人が付けた期待値。判定器の答えと突き合わせて「台本と一致/不一致」を出すだけ */
  kind: "chatter" | "business";
};

const line = (id: string, kind: SampleEntry["kind"], text: string): SampleEntry => ({ id, text, kind });

/**
 * 「与信照会つき見積作成」が前提にしている登場人物。
 * 顧客と部長は会話の中で初めて出てくるので、ここには入れない（新しい登場人物を
 * 判定器が見つけ、gemma が名前を特定する流れを見せるため）。
 */
export const SAMPLE_SCENARIO_ACTORS: { name: string; kind: ActorKind }[] = [
  { name: "営業", kind: "role" },
  { name: "与信部", kind: "role" },
];

export const SAMPLE_SCENARIO: SampleEntry[] = [
  line("u01", "chatter", "はい、それでは始めましょう。音声は聞こえていますか？"),
  line("u02", "business", "この業務の目的は、与信リスクのある取引を避けつつ、見積を素早く返すことです。"),
  line("u03", "business", "まず、顧客から営業に見積の依頼が来ます。"),
  line("u04", "business", "営業は、与信部に与信照会をかけます。"),
  line("u05", "chatter", "あ、そういえば昨日の野球、見ました？"),
  line("u06", "business", "与信部は、可否を営業に回答します。"),
  line("u07", "business", "与信がOKなら、営業が顧客に見積を提示します。"),
  line("u08", "business", "NGの場合は、営業が顧客にお断りの連絡をします。"),
  line("u09", "business", "高額のときは、ケースバイケースで部長が判断してますね。"),
  line("u10", "business", "その与信の判断は、実は田中さんにしか分からないんですよね。"),
  line("u11", "chatter", "ちょっと休憩にしましょうか。"),
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
 * **1 行 1 動作にしてある。** 「区切って、送ります」のように 1 文に 2 つ入れると、
 * 後ろの動作しか図に出ない（実測で 4 工程が消えた）。会議の発言も同じで、動作を分けて
 * 話すほど図が細かくなる。
 *
 * **「〜が〜に返します」という返答の行は、あえて残してある。** 直前の往路ステップと
 * 同じ内容と判定されて図に出ないことが多いが（実測）、実際の会議でも返答は省略されがち
 * なので、その抜けを図が炙り出す様子ごと見せるため。叩き台として使うときの素の姿に近い。
 */

/**
 * 「このアプリの仕組み」が前提にしている登場人物。こちらは 6 者すべてが台本に出るので
 * 全部を宣言する。足りないと「サーバーは、gemma に名前を書くよう依頼します」のような行が、
 * 名前に関する既存ステップ（ブラウザ↔サーバー）の重複と判定されて図に入らない（実測）。
 */
export const APP_SCENARIO_ACTORS: { name: string; kind: ActorKind }[] = [
  { name: "ブラウザ", kind: "system" },
  { name: "サーバー", kind: "system" },
  { name: "whisper", kind: "system" },
  { name: "DiffusionGemma", kind: "system" },
  { name: "gemma", kind: "system" },
  { name: "Mermaid", kind: "system" },
];

export const APP_SCENARIO: SampleEntry[] = [
  line("a01", "chatter", "はい、では録画も回っているので始めましょう。"),
  line("a02", "business", "この仕組みの目的は、会議中の発言から、その場で業務フロー図を作ることです。"),
  // ── 音声 → 文字（whisper） ──
  line("a03", "business", "まず、ブラウザが、マイクの音声を無音で区切ります。"),
  line("a04", "business", "ブラウザは、区切った音声と語彙ヒントを、サーバーに送ります。"),
  line("a05", "business", "サーバーは、音声と語彙ヒントを whisper に渡して、文字起こしを依頼します。"),
  line("a06", "business", "whisper は、日本語の文字に起こして、サーバーに返します。"),
  line("a07", "chatter", "あ、コーヒーのおかわり取ってきてもいいですか？"),
  line("a08", "business", "サーバーは、文字から定型の誤認識を取り除きます。"),
  line("a09", "business", "サーバーは、文字起こしを、ブラウザに返します。"),
  // ── 文字 → 判定（DiffusionGemma） ──
  line("a10", "business", "ブラウザは、その文字と図の現状を、サーバーに送って判定を依頼します。"),
  line("a11", "business", "サーバーは、図の現状を見て、16 個の質問を組み立てます。"),
  line("a12", "business", "サーバーは、16 個の質問をまとめて DiffusionGemma に送ります。"),
  line("a13", "business", "DiffusionGemma は、それぞれの質問に確率で答えて、サーバーに返します。"),
  line("a14", "business", "サーバーは、確率を閾値と比べて、図への変更の一覧に直します。"),
  line("a15", "business", "サーバーは、変更の一覧を、ブラウザに渡します。"),
  // ── 変更の適用（分岐: 雑談 / 業務の話） ──
  line("a16", "business", "判定が雑談なら、ブラウザは、その発言を図に入れずに捨てます。"),
  line("a17", "business", "業務の話なら、ブラウザは変更の一覧を図のデータに反映します。"),
  // ── ステップ名（gemma） ──
  line("a18", "business", "反映したあと、ブラウザは、ステップの名前を作るようにサーバーに頼みます。"),
  line("a19", "business", "サーバーは、gemma に名前を書くよう依頼します。"),
  line("a20", "business", "gemma は、名前を書いて、サーバーに返します。"),
  line("a21", "chatter", "すみません、少し窓を開けてもいいですか。暑くなってきました。"),
  line("a22", "business", "サーバーは、gemma が書いた名前を、ブラウザに渡します。"),
  line("a23", "business", "ブラウザは、ステップの名前を、届いた名前に差し替えます。"),
  // ── 検証 ──
  line("a24", "business", "ブラウザは、次の発話を送るとき、前回の名前の検証も一緒にサーバーへ送ります。"),
  line("a25", "business", "サーバーは、その名前の検証を、DiffusionGemma への質問に加えます。"),
  line("a26", "business", "ブラウザは、確信が低いステップを点線の仮ステップにして、承認を待ちます。"),
  // ── 図の描画（Mermaid） ──
  line("a27", "business", "ブラウザは、図のデータから Mermaid のコードを書きます。"),
  line("a28", "business", "ブラウザは、Mermaid のコードを、Mermaid に渡します。"),
  line("a29", "business", "Mermaid は、そのコードから図の絵を描いて、ブラウザに返します。"),
  line("a30", "business", "図のデータを間に挟むのは、あとから取り消しや割り込みをできるようにするためです。"),
];
