import { notedTargets, noteState, type NoteState } from "../model/notes";
import type { FlowModel } from "../model/types";
import { drawnFrames, visibleSteps } from "./mermaid";

/**
 * 書き出す .svg に付箋を入れる。図の上では手順・枠・登場人物の横に番号付きの印を付け、
 * 図の下に付箋の一覧（番号・貼った先・決めること・決まったこと）を足す。印だけでは中身が分からず、
 * 画像は印刷や資料への貼り付けで使うので、中身は一覧で読めるようにする。
 *
 * 渡す SVG は、畳んだ枠を開いた図（枠はすべて描かれ、番号は元のまま）。Mermaid の素の出力で、
 * 番号の黒丸は線の端の飾り（marker）のまま。DOMParser を使うので、ブラウザでだけ呼ぶ。読めなければ元のまま
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const COLORS: Record<NoteState, { fill: string; stroke: string; text: string }> = {
  open: { fill: "#fde047", stroke: "#ca8a04", text: "#713f12" },
  answered: { fill: "#bbf7d0", stroke: "#16a34a", text: "#14532d" },
};
const FONT = "font-family:sans-serif;";
const LINE_H = 17;
const PAD = 12;

export function addNotesToSvg(svg: string, model: FlowModel): string {
  const noted = notedTargets(model);
  if (noted.length === 0) return svg;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (doc.querySelector("parsererror") || root.tagName.toLowerCase() !== "svg") return svg;
  const vb = root.getAttribute("viewBox")?.trim().split(/\s+/).map(Number);
  if (!vb || vb.length !== 4 || vb.some((n) => !Number.isFinite(n))) return svg;
  const [vx, vy, vw, vh] = vb;

  const el = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const badge = (x: number, y: number, no: number, state: NoteState) => {
    const c = COLORS[state];
    const w = no >= 10 ? 18 : 14;
    const g = el("g", { class: "note-badge" });
    g.append(
      el("rect", { x, y, width: w, height: 14, rx: 2, fill: c.fill, stroke: c.stroke }),
      el("text", { x: x + w / 2, y: y + 11, "text-anchor": "middle", style: `${FONT}font-size:10px;font-weight:700;fill:${c.text}` }, String(no)),
    );
    return g;
  };

  // 印を付ける先: 図の番号 → 黒丸の中心、枠の順 → 見出しの札、登場人物の id → 上の頭
  const steps = visibleSteps(model);
  const frames = drawnFrames(model);
  // 黒丸は、描いたときに番号ごとの円（.step-dot。mermaid-diagram.tsx の enlargeStepDots）になっている。
  // 円になっていなければ、Mermaid の素の形（番号の直前の線の端）から位置を取る
  const dotOf = new Map<number, { x: number; y: number; r: number }>();
  for (const num of doc.querySelectorAll(".sequenceNumber")) {
    const n = Number(num.textContent?.trim());
    if (!Number.isInteger(n)) continue;
    const circle = num.parentElement?.classList.contains("step-dot") ? num.parentElement.querySelector("circle") : null;
    if (circle) {
      dotOf.set(n, { x: Number(circle.getAttribute("cx")), y: Number(circle.getAttribute("cy")), r: Number(circle.getAttribute("r")) });
      continue;
    }
    const line = num.previousElementSibling;
    if (line && line.tagName === "line") dotOf.set(n, { x: Number(line.getAttribute("x1")), y: Number(line.getAttribute("y1")), r: 9 });
  }
  const labelBoxes = [...doc.querySelectorAll(".labelBox")];

  // 同じ場所に複数の付箋があれば、横に並べる
  const placed = new Map<string, number>();
  const put = (key: string, parent: Element, x: number, y: number, no: number, state: NoteState) => {
    const i = placed.get(key) ?? 0;
    placed.set(key, i + 1);
    parent.append(badge(x + i * 16, y, no, state));
  };

  noted.forEach(({ note }, i) => {
    const no = i + 1;
    const state = noteState(note);
    steps.forEach((s, k) => {
      const dot = note.relatedStepIds.includes(s.id) ? dotOf.get(k + 1) : undefined;
      if (dot) put(`s${k}`, root, dot.x + dot.r - 2, dot.y - dot.r - 12, no, state);
    });
    frames.forEach((arms, k) => {
      const box = labelBoxes[k];
      if (!box || !note.relatedFrameIds?.includes(arms[0].groupId)) return;
      // 札は左上の角から右下へ切った多角形（drawLabel）。点の座標から右端と上端を取る
      const pts = (box.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      const xs = pts.filter((_, j) => j % 2 === 0);
      const ys = pts.filter((_, j) => j % 2 === 1);
      if (xs.length === 0) return;
      put(`f${k}`, box.parentElement ?? root, Math.max(...xs) + 4, Math.min(...ys) + 3, no, state);
    });
    for (const id of note.relatedActorIds ?? []) {
      const head = doc.querySelector(`rect.actor-top[name="${id}"]`);
      if (head) {
        const x = Number(head.getAttribute("x")) + Number(head.getAttribute("width")) - 10;
        put(`a${id}`, root, x, Number(head.getAttribute("y")) - 7, no, state);
        continue;
      }
      // 人型は頭の円の右上に
      const circle = doc.querySelector(`g.actor-man.actor-top[name="${id}"] circle`);
      if (circle) {
        const r = Number(circle.getAttribute("r"));
        put(`a${id}`, root, Number(circle.getAttribute("cx")) + r, Number(circle.getAttribute("cy")) - r - 4, no, state);
      }
    }
  });

  // 図の下の一覧
  const maxChars = Math.max(20, Math.floor((vw - PAD * 4) / 12));
  const wrap = (text: string) => {
    const chars = [...text];
    const out: string[] = [];
    for (let i = 0; i < chars.length; i += maxChars) out.push(chars.slice(i, i + maxChars).join(""));
    return out.length > 0 ? out : [""];
  };
  const list = el("g", { class: "note-list" });
  let y = vy + vh + 24;
  list.append(el("text", { x: vx + PAD, y, style: `${FONT}font-size:14px;font-weight:700;fill:#333` }, "付箋（チームで決めること）"));
  y += 10;
  noted.forEach(({ note, where }, i) => {
    const state = noteState(note);
    const lines = [
      ...wrap(`決めること: ${note.prompt?.text ?? note.question}`),
      ...wrap(`決まったこと: ${state === "answered" ? (note.answer ?? "") : "（未決）"}`),
    ];
    const h = PAD + LINE_H * (lines.length + 1) + 4;
    list.append(el("rect", { x: vx + PAD, y, width: vw - PAD * 2, height: h, rx: 3, fill: "#fff9c4", stroke: "#d4c36a" }));
    list.append(badge(vx + PAD * 2, y + 8, i + 1, state));
    list.append(el("text", { x: vx + PAD * 2 + 22, y: y + 19, style: `${FONT}font-size:12px;font-weight:700;fill:#333` }, where));
    lines.forEach((line, j) => {
      list.append(el("text", { x: vx + PAD * 2, y: y + 19 + LINE_H * (j + 1), style: `${FONT}font-size:12px;fill:#333` }, line));
    });
    y += h + 6;
  });
  root.append(list);
  root.setAttribute("viewBox", `${vx} ${vy} ${vw} ${y - vy + 10}`);
  return new XMLSerializer().serializeToString(root);
}
