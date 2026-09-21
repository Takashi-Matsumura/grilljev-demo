/**
 * LLM の出力から、最初の JSON オブジェクトを取り出す。
 *
 * `JSON.parse` の直呼びは禁止: gemma は「JSON だけ」と指示しても ```json のフェンスで包んだり、
 * 前後に一言足したりする（実測でフェンス付きを確認）。フェンスを剥がし、最初の `{` から
 * 括弧の釣り合う `}` まで（文字列内の括弧は数えない）を切り出して parse する。
 * 失敗したら例外ではなく null を返す（呼び出し側は静かに見送れる）。
 */
export function extractJson(text: string): unknown | null {
  const s = text.replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
