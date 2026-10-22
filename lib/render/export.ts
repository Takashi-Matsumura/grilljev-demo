import { PLACEHOLDER_TEXT } from "./mermaid";

/**
 * 書き出し用の小さな純関数（ファイル名と SVG の整形）。ダウンロード自体はブラウザ側（component）で行う。
 */

/** svg11 = SVG 1.1 に揃えた .svg（Canva など、CSS を読まない取り込み先向け。app/components/svg11.ts） */
export type ExportFormat = "drawio" | "mmd" | "svg" | "svg11" | "md";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  drawio: "application/vnd.jgraph.mxfile",
  mmd: "text/plain;charset=utf-8",
  svg: "image/svg+xml;charset=utf-8",
  svg11: "image/svg+xml;charset=utf-8",
  md: "text/markdown;charset=utf-8",
};

const FORBIDDEN_IN_FILENAME = /[\\/:*?"<>|\u0000-\u001F\s]+/g;
const MAX_NAME_CHARS = 40;

/** 「対象業務名-YYYYMMDD-HHmm.拡張子」。OS で使えない文字と空白は _ にする。 */
export function exportFileName(title: string, format: ExportFormat, now: Date = new Date()): string {
  const base =
    title.trim().replace(FORBIDDEN_IN_FILENAME, "_").replace(/^_+|_+$/g, "").slice(0, MAX_NAME_CHARS) ||
    "flow";
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  // SVG 1.1 は中身の書き方が違うだけで、ファイルとしては .svg（名前の末尾で、ふつうの .svg と見分ける）
  return format === "svg11" ? `${base}-${stamp}-svg11.svg` : `${base}-${stamp}.${format}`;
}

/**
 * Mermaid が返す SVG を、単体のファイルとして開ける形にする。
 * - XML 宣言を付ける
 * - `width="100%"` のままだと、単体で開いたときの大きさが定まらないので、viewBox の寸法にする
 */
export function finalizeSvg(svg: string): string {
  const root = svg.match(/<svg\b[^>]*>/);
  let out = svg;
  if (root) {
    const tag = root[0];
    const vb = tag.match(/viewBox="([-\d.\s]+)"/);
    if (vb) {
      const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
      if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
        const fixed = tag
          .replace(/\swidth="[^"]*"/, ` width="${Math.ceil(w)}"`)
          .replace(/\sheight="[^"]*"/, "")
          .replace(/<svg\b/, `<svg height="${Math.ceil(h)}"`);
        out = svg.replace(tag, fixed);
      }
    }
  }
  return out.startsWith("<?xml") ? out : `<?xml version="1.0" encoding="UTF-8"?>\n${out}`;
}

/**
 * 画面の図から、空の場合の注記（「＋ ここにステップを追加」）を外した SVG にする（.svg の書き出し用）。
 * 注記は画面で押すためのもので、図の中身ではない。外したあとは、条件だけの空の枠として残る。
 * DOMParser を使うので、ブラウザでだけ呼ぶ。
 */
export function stripPlaceholders(svg: string): string {
  if (!svg.includes(PLACEHOLDER_TEXT)) return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const text of doc.querySelectorAll(".noteText")) {
    if (text.textContent?.trim() !== PLACEHOLDER_TEXT) continue;
    // 注記は <g>（枠の rect + 文字）にまとまっている
    const g = text.parentElement;
    if (g && g.tagName.toLowerCase() === "g") g.remove();
    else text.remove();
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
}
