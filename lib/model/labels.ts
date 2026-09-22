import type { IssueKind } from "./types";

/**
 * 論点の種別を表す短い日本語ラベル。ファシリテーターの質問カード（facilitator-pane.tsx）と、
 * 図の下の「未解決の論点」一覧（diagram-pane.tsx）が、同じ論点を別々の場所に出すため、
 * ラベルをここ 1 箇所にまとめる（表記のずれを防ぐ）。
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
