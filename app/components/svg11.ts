import { finalizeSvg } from "@/lib/render/export";

/**
 * Mermaid の SVG を、SVG 1.1 の範囲で書き直す（書き出しの「SVG 1.1」。Canva など、CSS を読まない取り込み先向け）。
 *
 * Mermaid の SVG は、見た目を `<style>` の CSS（`#mermaid-1 .messageText {…}`、`@keyframes` 入り）で付け、
 * SVG 2 の `feDropShadow` も使う。取り込み先が CSS を読まないと、線も文字も既定の黒・大きさになるか、
 * ファイルごと受け付けられない（Canva で実際に取り込めなかった）。そこで:
 * - ブラウザが計算した見た目（getComputedStyle）を、要素ごとの属性（fill・stroke・font-size など）に書き直す
 * - `<style>`・class・style 属性・role / aria-*、SVG 2 の影（filter）、使っていない `<symbol>` を外す
 * - 色は SVG 1.1 の書き方にする（rgba の透明度は fill-opacity / stroke-opacity へ）
 * - 字体の候補に和文の字体を足す（Mermaid の既定は欧文の字体だけで、日本語は取り込み先の代わりの字体になる）
 * - 矢印の先・番号の丸（`<marker>`）を、その場の図形に描き込む（Mermaid の marker は SVG 2 の
 *   `orient="auto-start-reverse"` を使う。Canva は「線や文字は展開しておく」ことを求めている）
 * - 幅を 200 にする（Canva の SVG の条件は「幅 150〜200 ピクセル」。中身は viewBox で縮むだけで、劣化しない）
 * - 文字の縦位置の指定（dominant-baseline / alignment-baseline）を使わず、その分 y をずらす
 *   （Canva はこの指定があると取り込まない。属性を 1 つずつ足した試験ファイルで確かめた）
 * - id を外す（Mermaid は人型の登場人物の部品に、上と下で同じ id を付ける。Canva は id の重なりがあると取り込まない。
 *   これも試験ファイルで確かめた。marker を描き込んだあとは、id を参照するものは残らない）
 * - DOCTYPE は付けない（外部の DTD を読みに行く宣言は、取り込み先によっては拒まれる）。version="1.1" で示す
 *
 * 計算した見た目を読むため、いったん画面外に置いて描く。ブラウザでだけ呼ぶ。
 */

/** 書き直す見た目の項目と、SVG の初期値（初期値と同じなら書かない） */
const PROPS: [string, string | null][] = [
  ["fill", "rgb(0, 0, 0)"],
  ["fill-opacity", "1"],
  ["fill-rule", "nonzero"],
  ["stroke", "none"],
  ["stroke-width", "1px"],
  ["stroke-opacity", "1"],
  ["stroke-dasharray", "none"],
  ["stroke-dashoffset", "0px"],
  ["stroke-linecap", "butt"],
  ["stroke-linejoin", "miter"],
  ["stroke-miterlimit", "4"],
  ["opacity", "1"],
  ["font-family", null],
  ["font-size", null],
  ["font-weight", "400"],
  ["font-style", "normal"],
  ["text-anchor", "start"],
];

/** 見た目を書く要素（g は透明度だけ。中身の要素に直接書くので、継承に頼らない） */
const PAINTED = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan"]);
const TEXT = new Set(["text", "tspan"]);

/** 和文の字体の候補。欧文の字体の後ろ、総称（sans-serif）の手前に足す */
const JA_FONTS = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, 'Noto Sans JP'";

/** SVG 1.1 でその要素に無い属性 */
const MISPLACED: Record<string, string[]> = {
  path: ["x1", "x2", "y1", "y2"],
  circle: ["width", "height"],
};

/** 書き出す幅（Canva の条件「幅 150〜200 ピクセル」の上限） */
const EXPORT_WIDTH = 200;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 文字の縦位置の指定（Mermaid は「上下中央」= central を使う）を外し、同じ位置に描かれるよう y をずらす。
 * ずらす量は、指定ありと指定なし（ベースライン）で、ブラウザが描いた文字の位置を測って決める（字体で変わるため）。
 * CSS の指定より優先させるため、測るときは style で上書きする（style 属性はあとで全部外す）
 */
function flattenBaselines(root: Element) {
  for (const text of root.querySelectorAll<SVGTextElement>("text")) {
    const parts = [text, ...text.querySelectorAll<SVGTSpanElement>("tspan")];
    const before = text.getBBox().y;
    for (const el of parts) {
      el.style.setProperty("dominant-baseline", "auto");
      el.style.setProperty("alignment-baseline", "auto");
    }
    const shift = before - text.getBBox().y;
    if (Number.isFinite(shift) && Math.abs(shift) > 0.01) {
      for (const el of parts) {
        const y = el.getAttribute("y");
        if (y !== null && y.trim() !== "") {
          el.setAttribute("y", y.trim().split(/[\s,]+/).map((v) => String(Math.round((Number(v) + shift) * 100) / 100)).join(" "));
        }
      }
    }
  }
  for (const el of root.querySelectorAll("[dominant-baseline], [alignment-baseline]")) {
    el.removeAttribute("dominant-baseline");
    el.removeAttribute("alignment-baseline");
  }
}

/** 図形の座標の数を、点の並びとして読む（"M 664,531 C 724,521 724,561 664,551" → 4 点） */
function points(el: Element): [number, number][] {
  if (el.tagName.toLowerCase() === "line") {
    const n = (a: string) => Number(el.getAttribute(a) ?? 0);
    return [
      [n("x1"), n("y1")],
      [n("x2"), n("y2")],
    ];
  }
  const nums = (el.getAttribute("d") ?? "").match(/-?\d*\.?\d+(?:e-?\d+)?/gi)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i], nums[i + 1]]);
  return out;
}

/**
 * marker を、線の端に置いた図形の複製に置き換える。向きは線の端の接線（直線はその向き、曲線は最後の制御点から）。
 * marker の中身は、図形の処理で見た目を属性に書き直し済み
 */
function inlineMarkers(root: Element) {
  const markers = new Map([...root.querySelectorAll("marker")].map((m) => [m.getAttribute("id"), m]));
  for (const el of [...root.querySelectorAll("[marker-start], [marker-end]")]) {
    const pts = points(el);
    for (const end of ["marker-start", "marker-end"] as const) {
      const ref = /url\(['"]?#([^'")]+)['"]?\)/.exec(el.getAttribute(end) ?? "")?.[1];
      el.removeAttribute(end);
      const marker = ref ? markers.get(ref) : undefined;
      if (!marker || pts.length === 0) continue;
      const atStart = end === "marker-start";
      const [p, q] = atStart ? [pts[0], pts[1] ?? pts[0]] : [pts[pts.length - 1], pts[pts.length - 2] ?? pts[0]];
      // 線の向き（始点なら始点 → 次の点、終点なら前の点 → 終点）
      const dx = atStart ? q[0] - p[0] : p[0] - q[0];
      const dy = atStart ? q[1] - p[1] : p[1] - q[1];
      let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const orient = marker.getAttribute("orient") ?? "0";
      if (orient === "auto-start-reverse" && atStart) angle += 180;
      else if (orient !== "auto" && orient !== "auto-start-reverse") angle = Number(orient) || 0;
      const scale = marker.getAttribute("markerUnits") === "userSpaceOnUse" ? 1 : Number(el.getAttribute("stroke-width") ?? 1) || 1;
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute(
        "transform",
        `translate(${p[0]} ${p[1]}) rotate(${angle}) scale(${scale}) translate(${-Number(marker.getAttribute("refX") ?? 0)} ${-Number(marker.getAttribute("refY") ?? 0)})`,
      );
      for (const child of marker.children) g.append(child.cloneNode(true));
      el.after(g);
    }
  }
  for (const m of markers.values()) m.remove();
  for (const defs of root.querySelectorAll("defs")) if (defs.children.length === 0) defs.remove();
}

/** "rgba(r, g, b, a)" → ["rgb(r, g, b)", a]。透明なら "none" */
function splitAlpha(color: string): [string, number] {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(color);
  if (!m) return [color, 1];
  const a = Number(m[4]);
  return a === 0 ? ["none", 1] : [`rgb(${m[1]}, ${m[2]}, ${m[3]})`, a];
}

/** "3px, 3px" → "3, 3"。SVG 1.1 でも px は使えるが、数値だけのほうが取り込み先で解釈の揺れが少ない */
const unitless = (v: string) => v.replace(/(\d)px\b/g, "$1");

function fontFamily(v: string): string {
  const list = v.replace(/"/g, "'");
  return /sans-serif\s*$/.test(list) ? list.replace(/,?\s*sans-serif\s*$/, `, ${JA_FONTS}, sans-serif`) : `${list}, ${JA_FONTS}`;
}

export function toSvg11(svg: string): string {
  const host = document.createElement("div");
  // 計算した見た目を読むので、描かれる状態で画面外に置く（visibility: hidden は子に継承されるので使わない）
  host.style.cssText = "position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none";
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  if (parsed.tagName.toLowerCase() !== "svg") return finalizeSvg(svg);
  const root = document.importNode(parsed, true);
  host.append(root);
  document.body.append(host);
  try {

    // 先にすべて読んでから書き換える（書きながら読むと、外した CSS の分だけ値が変わる）
    const elements = [...root.querySelectorAll("*")];
    const computed = elements.map((el) => {
      const tag = el.tagName.toLowerCase();
      if (!PAINTED.has(tag) && tag !== "g") return null;
      const cs = getComputedStyle(el);
      return PROPS.map(([name]) => [name, cs.getPropertyValue(name).trim()] as const);
    });

    elements.forEach((el, i) => {
      const values = computed[i];
      if (!values) return;
      const tag = el.tagName.toLowerCase();
      const attrs = new Map<string, string>();
      const alpha = new Map<string, number>();
      for (const [name, raw] of values) {
        if (tag === "g" && name !== "opacity") continue;
        if (!TEXT.has(tag) && (name.startsWith("font-") || name === "text-anchor" || name.endsWith("baseline"))) continue;
        if (name === "fill" || name === "stroke") {
          const [color, a] = splitAlpha(raw);
          attrs.set(name, color);
          if (a < 1) alpha.set(name, a);
        } else {
          attrs.set(name, name === "font-family" ? fontFamily(raw) : unitless(raw));
        }
      }
      // rgba の透明度は、fill-opacity / stroke-opacity に掛け合わせる（SVG 1.1 の色は rgb まで）
      for (const [name, a] of alpha) {
        attrs.set(`${name}-opacity`, String(Number(attrs.get(`${name}-opacity`) || 1) * a));
      }
      // tspan は親の text の属性を継ぐので、初期値でも省かない（省くと、名前の文字が箱の色を継いだ。実測）
      const inherits = tag === "tspan";
      for (const [name, value] of attrs) {
        const initial = PROPS.find(([n]) => n === name)?.[1];
        if (value === "" || (!inherits && initial != null && unitless(initial) === value)) el.removeAttribute(name);
        else el.setAttribute(name, value);
      }
    });

    flattenBaselines(root);
    // marker は id で探すので、id を外すより先に描き込む
    inlineMarkers(root);

    // CSS と、SVG 1.1 に無いもの・要らないものを外す
    for (const el of root.querySelectorAll("style, filter, symbol")) el.remove();
    for (const el of [root, ...root.querySelectorAll("*")]) {
      for (const attr of [...el.attributes]) {
        const n = attr.name;
        // name は Mermaid が登場人物の箱に付ける独自の属性（SVG 1.1 に無い）
        if (["class", "style", "role", "filter", "name", "id"].includes(n) || n.startsWith("aria-") || n.startsWith("data-")) {
          el.removeAttribute(n);
        }
      }
    }
    // Mermaid が付ける、その要素には無い属性（自分への矢印の path の x1、番号の丸の width / height）
    for (const [tag, names] of Object.entries(MISPLACED)) {
      for (const el of root.querySelectorAll(tag)) for (const n of names) el.removeAttribute(n);
    }
    root.setAttribute("version", "1.1");
    root.setAttribute("xmlns", "http://www.w3.org/2000/svg");

    const vb = (root.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number);
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      root.setAttribute("width", String(EXPORT_WIDTH));
      root.setAttribute("height", String(Math.round((EXPORT_WIDTH * vb[3]) / vb[2])));
    }
    const xml = new XMLSerializer().serializeToString(root);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
  } finally {
    host.remove();
  }
}
