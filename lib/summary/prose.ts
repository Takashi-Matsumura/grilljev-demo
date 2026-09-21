/**
 * gemma が書く「概要」と「改善候補」の検証。純関数。
 * gemma の出力は信用しない: 形・長さを確かめ、駄目なら null / 空（ドキュメントは事実の部分だけで成立する）。
 */

export type SummaryProse = {
  /** 業務概要の 1 段落。書けなければ null */
  overview: string | null;
  /** 改善候補（自動化・属人化解消・廃止の候補）。書けなければ空 */
  improvements: string[];
};

export const MAX_OVERVIEW_CHARS = 300;
export const MAX_IMPROVEMENT_CHARS = 100;
export const MAX_IMPROVEMENTS = 4;

const oneLine = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" || s.length > max ? null : s;
};

export function parseProse(json: unknown): SummaryProse {
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const improvements = Array.isArray(j.improvements)
    ? j.improvements
        .map((x) => oneLine(x, MAX_IMPROVEMENT_CHARS))
        .filter((x): x is string => x !== null)
        .slice(0, MAX_IMPROVEMENTS)
    : [];
  return { overview: oneLine(j.overview, MAX_OVERVIEW_CHARS), improvements: [...new Set(improvements)] };
}
