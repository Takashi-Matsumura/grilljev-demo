import type { IssueKind, StepFlags } from "./types";

/**
 * 論点の種別を表す短い日本語ラベル。ファシリテーターの質問カード（facilitator-pane.tsx）と、
 * 図の下の「要対応」一覧（attention-panel.tsx）が、同じ論点を別々の場所に出すため、
 * ラベルをここ 1 箇所にまとめる（表記のずれを防ぐ）。
 * ただし「いま出している問い」（status: "asked"）は質問カードだけが持ち、要対応には出さない
 * （lib/model/attention.ts の buildAttention を参照。二重表示を避けるため）。
 */
export const ISSUE_KIND_LABEL: Record<IssueKind, string> = {
  purpose: "目的",
  who: "担当",
  when: "時期",
  criteria: "基準",
  exception: "例外",
  tool: "道具",
  handoff: "引継ぎ",
};

/**
 * ops-grill の掘り下げ軸（例外・暗黙知・属人化）の短い日本語ラベル。
 * attention-panel.tsx（要対応の集計）でのみ使う。
 *
 * 注意: lib/render/mermaid.ts（ステップ名の末尾の［例外］［暗黙知］［属人］）と
 * lib/summary/markdown.ts（「属人化」表記）には、これとは別に同種のラベルが
 * ハードコードされている。それらは .mmd / .drawio / .svg / 業務分掌ドキュメントという
 * 書き出し成果物の文字列そのものなので、ここでは統一しない（別途まとめて直す）。
 */
export const STEP_FLAG_LABEL: Record<keyof StepFlags, string> = {
  exception: "例外",
  tacit: "暗黙知",
  personDependent: "属人",
};
