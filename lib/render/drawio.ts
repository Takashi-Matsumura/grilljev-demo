import type { FlowModel, MessageKind, Step } from "@/lib/model/types";
import { flagSuffix } from "./mermaid";
import {
  HEAD_H,
  HEAD_Y,
  MARGIN_X,
  PURPOSE_Y,
  SELF_OUT,
  TITLE_Y,
  layoutDiagram,
} from "./layout";

/**
 * FlowModel → draw.io（diagrams.net）の mxGraph XML。純関数。
 *
 * **非圧縮の `<mxGraphModel>` をそのまま出す**（draw.io は非圧縮の XML を開ける）。deflate + base64 が
 * 要らず、差分を目でも読める。ライフラインの縦の点線は自分では引かない — `shape=umlLifeline` に
 * 図の高さぶんの height を与えると、draw.io が自動で描く。
 *
 * メッセージは source/target を指定せず、`sourcePoint` / `targetPoint` の絶対座標で引く。
 * ライフラインへのアンカーを使うと、draw.io の再レイアウトと自前の座標計算が食い違うため。
 */

// ── エスケープ ─────────────────────────────────────────────────────
// `html=1` の図形は value を **HTML として**解釈する。だからラベルの `<` は先に HTML として
// 退避し（→ `&lt;`）、それを XML の属性として更に退避する（→ `&amp;lt;`）。
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function attrEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\s*[\r\n]+\s*/g, " ");
}

/** 図形の value（HTML として解釈される）。 */
const val = (s: string): string => attrEscape(htmlEscape(s.replace(INVALID_XML, "")));
/** HTML として解釈されない属性（ページ名など）。 */
const plain = (s: string): string => attrEscape(s.replace(INVALID_XML, ""));

// ── スタイル ───────────────────────────────────────────────────────
const LIFELINE_COMMON =
  "shape=umlLifeline;perimeter=lifelinePerimeter;html=1;container=0;" +
  "collapsible=0;recursiveResize=0;outlineConnect=0;";
const BOX_LIFELINE = `${LIFELINE_COMMON}whiteSpace=wrap;size=${HEAD_H};`;
// 人型の図形は幅が 20px しかない。折り返し（wrap）を許すと名前が 1 文字ずつ縦に折れるので、
// nowrap にする。名前は人型の下に出す（spacingTop は人型の高さ 40 を超えないと足に重なる）。
const ACTOR_LIFELINE = `${LIFELINE_COMMON}participant=umlActor;whiteSpace=nowrap;verticalAlign=top;spacingTop=46;`;

const MESSAGE_STYLE: Record<MessageKind, string> = {
  sync: "html=1;verticalAlign=bottom;endArrow=block;rounded=0;",
  async: "html=1;verticalAlign=bottom;endArrow=open;endSize=12;rounded=0;",
  reply: "html=1;verticalAlign=bottom;endArrow=open;endSize=12;dashed=1;rounded=0;",
  self: "html=1;verticalAlign=bottom;align=left;endArrow=block;rounded=0;",
};

/** 確信のないステップは、点線・灰色・「（仮）」で描く（Mermaid 側と同じ規則）。 */
function messageStyle(step: Step, self: boolean): string {
  const base = MESSAGE_STYLE[self ? "self" : step.kind];
  return step.status === "provisional" ? `${base}dashed=1;strokeColor=#999999;fontColor=#777777;` : base;
}

const num = (n: number): string => String(Math.round(n * 100) / 100);

export function toDrawio(model: FlowModel, at: string = new Date().toISOString()): string {
  const lay = layoutDiagram(model);
  const cells: string[] = [];
  let n = 2; // 0 と 1 は予約（ルートとレイヤ）
  const id = () => `c${n++}`;

  const text = (value: string, x: number, y: number, w: number, h: number, style: string) =>
    cells.push(
      `<mxCell id="${id()}" value="${val(value)}" style="${style}" vertex="1" parent="1">` +
        `<mxGeometry x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" as="geometry"/></mxCell>`,
    );

  const line = (x1: number, y1: number, x2: number, y2: number, style: string) =>
    cells.push(
      `<mxCell id="${id()}" value="" style="${style}" edge="1" parent="1">` +
        `<mxGeometry relative="1" as="geometry">` +
        `<mxPoint x="${num(x1)}" y="${num(y1)}" as="sourcePoint"/>` +
        `<mxPoint x="${num(x2)}" y="${num(y2)}" as="targetPoint"/></mxGeometry></mxCell>`,
    );

  // ── タイトルと目的 ──
  text(model.scope.title || "業務フロー", MARGIN_X, TITLE_Y, Math.max(320, lay.width - MARGIN_X * 2), 26,
    "text;html=1;align=left;verticalAlign=middle;fontSize=16;fontStyle=1;");
  if (model.scope.purpose) {
    text(`目的: ${model.scope.purpose}`, MARGIN_X, PURPOSE_Y, Math.max(320, lay.width - MARGIN_X * 2), 20,
      "text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#666666;");
  }

  // ── 枠（alt / opt / loop）。背面に置くため、ライフラインより先に出す ──
  for (const f of lay.frames) {
    text(f.kind, f.x, f.y, f.w, f.h,
      "shape=umlFrame;whiteSpace=wrap;html=1;width=60;height=24;fillColor=none;verticalAlign=top;align=left;");
    for (const y of f.dividers) line(f.x, y, f.x + f.w, y, "endArrow=none;html=1;dashed=1;strokeColor=#888888;");
    for (const c of f.conditions) {
      text(c.text, f.x + 70, c.y, Math.max(120, f.w - 80), 20, "text;html=1;align=left;verticalAlign=middle;fontSize=11;");
    }
  }

  // ── ライフライン。height を図の下端まで伸ばすと、縦の点線は draw.io が描く ──
  const lifeH = lay.height - HEAD_Y - 24;
  for (const a of lay.actors) {
    cells.push(
      `<mxCell id="${id()}" value="${val(a.name)}" style="${a.asActor ? ACTOR_LIFELINE : BOX_LIFELINE}" vertex="1" parent="1">` +
        `<mxGeometry x="${num(a.x)}" y="${HEAD_Y}" width="${num(a.w)}" height="${num(lifeH)}" as="geometry"/></mxCell>`,
    );
  }

  // ── メッセージ ──
  for (const r of lay.rows) {
    const label =
      r.step.label + flagSuffix(r.step) + (r.step.status === "provisional" ? "（仮）" : "");
    const style = messageStyle(r.step, r.self);
    if (r.self) {
      const y2 = r.msgY + 24;
      cells.push(
        `<mxCell id="${id()}" value="${val(label)}" style="${style}" edge="1" parent="1">` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${num(r.fromCx)}" y="${num(r.msgY)}" as="sourcePoint"/>` +
          `<mxPoint x="${num(r.fromCx)}" y="${num(y2)}" as="targetPoint"/>` +
          `<Array as="points"><mxPoint x="${num(r.fromCx + SELF_OUT)}" y="${num(r.msgY)}"/>` +
          `<mxPoint x="${num(r.fromCx + SELF_OUT)}" y="${num(y2)}"/></Array>` +
          `</mxGeometry></mxCell>`,
      );
    } else {
      cells.push(
        `<mxCell id="${id()}" value="${val(label)}" style="${style}" edge="1" parent="1">` +
          `<mxGeometry relative="1" as="geometry">` +
          `<mxPoint x="${num(r.fromCx)}" y="${num(r.msgY)}" as="sourcePoint"/>` +
          `<mxPoint x="${num(r.toCx)}" y="${num(r.msgY)}" as="targetPoint"/></mxGeometry></mxCell>`,
      );
    }
  }

  // ── 付箋（書類・システム名）──
  for (const note of lay.notes) {
    text(note.text, note.x, note.y, note.w, note.h,
      "shape=note;whiteSpace=wrap;html=1;size=12;fillColor=#FFF9C4;align=left;verticalAlign=top;fontSize=11;");
  }

  return (
    `<mxfile host="grilljev" modified="${plain(at)}" agent="grilljev-demo" version="24.0.0">\n` +
    `  <diagram id="d1" name="${plain(model.scope.title || "業務フロー")}">\n` +
    `    <mxGraphModel dx="1200" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="1" pageScale="1" pageWidth="${num(lay.width)}" pageHeight="${num(lay.height)}" ` +
    `math="0" shadow="0">\n` +
    `      <root>\n        <mxCell id="0"/>\n        <mxCell id="1" parent="0"/>\n` +
    cells.map((c) => `        ${c}`).join("\n") +
    `\n      </root>\n    </mxGraphModel>\n  </diagram>\n</mxfile>\n`
  );
}
