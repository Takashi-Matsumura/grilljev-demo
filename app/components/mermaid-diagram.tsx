"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayMark } from "@/lib/preview/scenes";
import type { NoteMarks, NoteState } from "@/lib/model/notes";
import { COLLAPSED_MARK, FOCUS_COMMENT, PLACEHOLDER_TEXT, type ArmTarget } from "@/lib/render/mermaid";

type MermaidApi = typeof import("mermaid").default;

/** 初期バンドルに入れない。最初の描画時に 1 回だけ読み込む。 */
let mermaidPromise: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((m) => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    m.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
    });
    return m.default;
  });
  return mermaidPromise;
}

const DEBOUNCE_MS = 300;

/** 番号（autonumber）とステップ名を、押せる見た目にする */
const PICKABLE_CLASS = (on: boolean) =>
  on
    ? "[&_.messageText]:cursor-pointer [&_.step-dot]:cursor-pointer [&_.messageText:hover]:fill-sky-600 [&_.messageText:hover]:underline [&_.step-dot:hover]:scale-130"
    : "";

/** 番号の黒丸の拡大アニメーション（押せるときだけ大きくなる。拡大の中心は丸の中心） */
const DOT_CLASS =
  "[&_.step-dot]:origin-center [&_.step-dot]:[transform-box:fill-box] [&_.step-dot]:transition-[scale] [&_.step-dot]:duration-150 [&_.step-dot]:ease-out motion-reduce:[&_.step-dot]:transition-none";

/** ドラッグで動かせるときの見た目（つかめるカーソル） */
const MOVABLE_CLASS = "[&_.messageText]:cursor-grab [&_.step-dot]:cursor-grab";

/**
 * 図の上から i 番目（0 始まり）に描いたメッセージの、ステップの番号（1 始まり）。
 * Mermaid はメッセージと番号（.sequenceNumber）を図の上から 1 つずつ描くので、i 番目どうしが対応する。
 * 枠を畳むと描かないステップがあるが、番号は元のまま振り直してある（toMermaid）ので、番号で数えれば崩れない。
 */
function numberAt(root: ParentNode, i: number): number | null {
  const nums = root.querySelectorAll(".sequenceNumber");
  if (nums.length === 0) return i + 1;
  const n = Number(nums[i]?.textContent?.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** ステップの番号（1 始まり）から、図の上から何番目に描いたメッセージか（0 始まり。描いていなければ -1） */
function drawnIndexOf(root: ParentNode, n: number): number {
  const nums = [...root.querySelectorAll(".sequenceNumber")];
  if (nums.length === 0) return n - 1;
  return nums.findIndex((num) => Number(num.textContent?.trim()) === n);
}

/**
 * 要素から、何番目（1 始まり）のステップかを割り出す。ステップの番号・名前でなければ null。
 * 番号（.sequenceNumber）はその数字を、ステップ名（.messageText）は図の中での出現順から番号を引く。
 */
function stepAt(target: EventTarget): number | null {
  if (!(target instanceof Element)) return null;
  const num = target.closest(".sequenceNumber") ?? target.closest(".step-dot")?.querySelector(".sequenceNumber");
  if (num) {
    const n = Number(num.textContent?.trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const text = target.closest(".messageText");
  const svg = text?.closest("svg");
  if (!text || !svg) return null;
  const i = [...svg.querySelectorAll(".messageText")].indexOf(text);
  return i >= 0 ? numberAt(svg, i) : null;
}

/**
 * 強調の印。CSS でステップ名の色を変える。選んでいるステップ（編集パネル）は青、声で直しているステップは橙。
 * 番号は黒い丸の上の白抜きなので色を変えない（変えると読めなくなる）。
 * 図のコードは変えずに描いた SVG へ印を付けるので、書き出す図には入らない。
 */
const SELECTED_ATTR = "data-selected";
const FOCUS_ATTR = "data-focus";
const MARK_CLASS = [
  "[&_.messageText[data-focus]]:!fill-amber-600 [&_.messageText[data-focus]]:font-bold dark:[&_.messageText[data-focus]]:!fill-amber-400",
  "[&_.messageText[data-selected]]:!fill-sky-600 [&_.messageText[data-selected]]:font-bold dark:[&_.messageText[data-selected]]:!fill-sky-400",
].join(" ");

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * 番号の黒丸を、1 つずつ動かせる円にする。Mermaid は黒丸を全番号共通のマーカー（線の端の飾り）で
 * 描くので、そのままでは 1 つだけ大きくできない。マーカーを外し、同じ位置・同じ色の円と番号を
 * `<g class="step-dot">` にまとめる（拡大は CSS）。ふつうは描いたときに enlargeStepDots が済ませているので、
 * ここは描き方が変わったときの備え（マーカーの残っている黒丸だけを扱う）。
 */
function detachStepDots(root: HTMLElement) {
  const fill = root.querySelector("marker[id$='sequencenumber'] circle");
  const color = fill ? getComputedStyle(fill).fill : "#333";
  for (const num of root.querySelectorAll(".sequenceNumber")) {
    const line = num.previousElementSibling;
    if (!line || line.tagName !== "line" || !line.getAttribute("marker-start") || num.parentElement?.classList.contains("step-dot")) {
      continue;
    }
    const g = document.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "step-dot");
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", line.getAttribute("x1") ?? "0");
    circle.setAttribute("cy", line.getAttribute("y1") ?? "0");
    circle.setAttribute("r", "9");
    circle.setAttribute("fill", color);
    line.removeAttribute("marker-start");
    num.replaceWith(g);
    g.append(circle, num);
  }
}

/**
 * 付箋の印（まだ決まっていなければ黄色の「?」、すべて決まれば緑の「✓」）を付ける。
 * 手順は番号の黒丸（.step-dot）の右上（押すとそのステップを選べる）、枠は見出しの札の右、登場人物は上の頭の右上。
 * 描いた SVG に足すだけで、書き出す図には入らない
 */
const NOTE_CLASS = "note-badge";
/** 枠の付箋の印に付ける、図の上から何番目の枠か（drawnFrames の順）／何番目の「▸ …」の注記か（collapsedFrames の順） */
const FRAME_NOTE_ATTR = "data-frame-note";
const FOLD_NOTE_ATTR = "data-fold-note";
function noteBadge(x: number, y: number, state: NoteState, what: string): SVGGElement {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("class", NOTE_CLASS);
  const rect = document.createElementNS(SVG_NS, "rect");
  for (const [k, v] of Object.entries({ x, y, width: 13, height: 13, rx: 2 })) rect.setAttribute(k, String(v));
  rect.setAttribute("fill", state === "open" ? "#fde047" : "#bbf7d0");
  rect.setAttribute("stroke", state === "open" ? "#ca8a04" : "#16a34a");
  const text = document.createElementNS(SVG_NS, "text");
  text.setAttribute("x", String(x + 6.5));
  text.setAttribute("y", String(y + 10));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "10");
  text.setAttribute("font-weight", "700");
  text.setAttribute("fill", state === "open" ? "#854d0e" : "#166534");
  text.textContent = state === "open" ? "?" : "✓";
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `${what}の付箋: ${state === "open" ? "まだ決まっていないことがあります" : "決まりごとがあります"}`;
  g.append(rect, text, title);
  return g;
}

/**
 * 番号の黒丸から出る矢印が左向きか。Mermaid は 1 つの手順を「矢印の線 → 黒丸の線（長さ 0）→ 番号」の順に描くので、
 * 黒丸の 2 つ前が矢印（自分の作業は右へ回る曲線の path）。分からなければ false
 */
function arrowGoesLeft(dot: Element): boolean {
  const arrow = dot.previousElementSibling?.previousElementSibling;
  if (!arrow || arrow.tagName !== "line" || !arrow.getAttribute("class")?.includes("messageLine")) return false;
  return Number(arrow.getAttribute("x2")) < Number(arrow.getAttribute("x1"));
}

function markNotes(root: HTMLElement, notes: NoteMarks | undefined) {
  for (const el of root.querySelectorAll(`.${NOTE_CLASS}`)) el.remove();
  if (!notes) return;
  for (const dot of root.querySelectorAll(".step-dot")) {
    const state = notes.steps.get(Number(dot.querySelector(".sequenceNumber")?.textContent?.trim()));
    const circle = dot.querySelector("circle");
    if (!state || !circle) continue;
    // 黒丸の横の、矢印が伸びない側に（上は手順名の文字にかかる）
    const cx = Number(circle.getAttribute("cx"));
    const cy = Number(circle.getAttribute("cy"));
    const x = arrowGoesLeft(dot) ? cx + STEP_DOT_R + 3 : cx - STEP_DOT_R - 16;
    dot.append(noteBadge(x, cy - 6.5, state, "手順"));
  }
  // 枠: 見出しの札（.labelBox）の順 = drawnFrames の順
  [...root.querySelectorAll(".labelBox")].forEach((box, i) => {
    const state = notes.frames.get(i);
    if (!state || !(box instanceof SVGGraphicsElement)) return;
    const b = box.getBBox();
    const badge = noteBadge(b.x + b.width + 3, b.y + 2, state, "枠");
    // 押すと枠の付箋のパネルを開く（MermaidDiagram の onFrameNotes）
    badge.setAttribute(FRAME_NOTE_ATTR, String(i));
    box.parentElement?.append(badge);
  });
  // 畳んだ枠の注記（「▸ …」）。markFrames が上から何番目かの印を付けている（= collapsedFrames の順）
  for (const folded of root.querySelectorAll(`[${COLLAPSED_ATTR}]`)) {
    const state = notes.folds.get(Number(folded.getAttribute(COLLAPSED_ATTR)));
    const rect = folded.querySelector("rect");
    if (!state || !(rect instanceof SVGGraphicsElement)) continue;
    const b = rect.getBBox();
    const badge = noteBadge(b.x + b.width - 8, b.y - 5, state, "畳んだ枠");
    badge.setAttribute(FOLD_NOTE_ATTR, folded.getAttribute(COLLAPSED_ATTR) ?? "");
    folded.append(badge);
  }
  // 登場人物: 上の頭（Mermaid は要素に name 属性で id を付ける）。箱は右上の角、人型は頭の円の右上
  // （人型の要素は名前の文字や見えない枠まで含んで横に広いので、要素の範囲ではなく円で決める。書き出しの svg-notes.ts と同じ）
  for (const [id, state] of notes.actors) {
    const box = root.querySelector(`rect.actor-top[name="${id}"]`);
    if (box instanceof SVGGraphicsElement) {
      const b = box.getBBox();
      box.parentElement?.append(noteBadge(b.x + b.width - 10, b.y - 7, state, "登場人物"));
      continue;
    }
    const circle = root.querySelector(`g.actor-man.actor-top[name="${id}"] circle`);
    if (!circle) continue;
    const r = Number(circle.getAttribute("r"));
    const cx = Number(circle.getAttribute("cx"));
    const cy = Number(circle.getAttribute("cy"));
    circle.parentElement?.append(noteBadge(cx + r, cy - r - 4, state, "登場人物"));
  }
}

/**
 * 空の場合の注記（「＋ ここにステップを追加」）に、上から何番目かの印を付ける（押せるようにするため）。
 * 印は描いた SVG に付けるだけなので、書き出す図には入らない。
 */
const PLACEHOLDER_ATTR = "data-placeholder";
function markPlaceholders(root: HTMLElement) {
  let k = 0;
  for (const text of root.querySelectorAll(".noteText")) {
    if (text.textContent?.trim() !== PLACEHOLDER_TEXT) continue;
    text.parentElement?.setAttribute(PLACEHOLDER_ATTR, String(k));
    k += 1;
  }
}

/**
 * 畳んだ枠の注記（「▸ alt …」）に、上から何番目かの印を付ける（押すと開く）。
 * 枠の見出し（alt / opt / loop の札）には、押すと畳めることを示す title を付ける。
 */
const COLLAPSED_ATTR = "data-collapsed";
function markFrames(root: HTMLElement, foldable: boolean, notable: boolean) {
  const more = notable ? "（右クリックで付箋を貼る）" : "";
  let k = 0;
  for (const text of root.querySelectorAll(".noteText")) {
    if (!text.textContent?.trim().startsWith(COLLAPSED_MARK)) continue;
    text.parentElement?.setAttribute(COLLAPSED_ATTR, String(k));
    addTitle(text.parentElement, `押すと枠を開きます${more}`);
    k += 1;
  }
  if (!foldable) return;
  for (const el of root.querySelectorAll(".labelText, .labelBox")) addTitle(el, `押すと枠を畳みます${more}`);
}

function addTitle(el: Element | null, text: string) {
  if (!el || el.querySelector(":scope > title")) return;
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = text;
  el.append(title);
}

/** 畳んだ枠の注記と、枠の見出しの見た目（押せる） */
const FRAME_CLASS = [
  "[&_.labelText]:cursor-pointer [&_.labelBox]:cursor-pointer [&_.labelBox:hover]:!fill-sky-100 dark:[&_.labelBox:hover]:!fill-sky-500/20",
  "[&_[data-collapsed]]:cursor-pointer [&_[data-collapsed]_rect]:!fill-zinc-100 [&_[data-collapsed]_rect]:!stroke-zinc-400",
  "[&_[data-collapsed]:hover_rect]:!fill-sky-50 [&_[data-collapsed]:hover_rect]:!stroke-sky-500",
  "dark:[&_[data-collapsed]_rect]:!fill-zinc-800 dark:[&_[data-collapsed]:hover_rect]:!fill-sky-500/10",
].join(" ");

/** 空の場合の注記の見た目（押せる、点線の枠） */
const PLACEHOLDER_CLASS = [
  "[&_[data-placeholder]]:cursor-pointer",
  "[&_[data-placeholder]_rect]:!fill-sky-50 [&_[data-placeholder]_rect]:!stroke-sky-500 [&_[data-placeholder]_rect]:[stroke-dasharray:4_3]",
  "[&_[data-placeholder]:hover_rect]:!fill-sky-100 [&_[data-placeholder]_text]:!fill-sky-700",
  "dark:[&_[data-placeholder]_rect]:!fill-sky-500/10 dark:[&_[data-placeholder]_text]:!fill-sky-300",
].join(" ");

/** n 番目（1 始まり）のステップ名に印を付ける（0 なら外す。畳んだ枠の中で描いていなければ付けない） */
function markStep(root: HTMLElement, attr: string, n: number) {
  for (const el of root.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  if (n > 0) root.querySelectorAll(".messageText")[drawnIndexOf(root, n)]?.setAttribute(attr, "");
}

/**
 * フローのプレビュー（flow-player.tsx）の強調。今の場面に関わる要素に印（data-play）を付け、
 * ほかは CSS（globals.css の .flow-play）で薄くする。今のステップの矢印には、送り手から受け手へ走る丸を描く。
 * 印も丸も描いた SVG に付けるだけなので、書き出す図には入らない。
 */
const PLAY_ATTR = "data-play";
function markPlay(root: HTMLElement, play: PlayMark) {
  for (const el of root.querySelectorAll(`[${PLAY_ATTR}]`)) el.removeAttribute(PLAY_ATTR);
  for (const el of root.querySelectorAll(".play-token")) el.remove();
  const mark = (el: Element | null | undefined) => el?.setAttribute(PLAY_ATTR, "");
  let focus: Element | null = null;

  if (play.step > 0) {
    const i = play.step - 1;
    const text = root.querySelectorAll(".messageText")[i];
    const line = root.querySelectorAll("[class*='messageLine']")[i];
    mark(text);
    mark(line);
    mark(root.querySelectorAll(".step-dot")[i]);
    focus = text ?? null;
    if (line && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) addToken(line);
  }
  if (play.note >= 0) mark(root.querySelectorAll(".noteText")[play.note]?.parentElement);
  if (play.frame >= 0) {
    mark(root.querySelectorAll(".labelText")[play.frame]);
    mark(root.querySelectorAll(".labelBox")[play.frame]);
    const c = play.condition;
    const text = c
      ? c.first
        ? root.querySelectorAll(".loopText")[play.frame]
        : root.querySelectorAll(".sectionTitle")[c.index]
      : null;
    mark(text);
    focus ??= text ?? root.querySelectorAll(".labelText")[play.frame] ?? null;
  }
  const names = new Set(play.actors);
  for (const t of root.querySelectorAll("text.actor")) {
    if (names.has(t.textContent?.trim() ?? "")) mark(t.parentElement);
  }
  focus?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

/** 矢印（直線、または自分への曲線）に沿って、送り手から受け手へ丸を走らせる */
function addToken(line: Element) {
  const d =
    line.tagName === "line"
      ? `M ${line.getAttribute("x1")} ${line.getAttribute("y1")} L ${line.getAttribute("x2")} ${line.getAttribute("y2")}`
      : line.getAttribute("d");
  if (!d) return;
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("class", "play-token");
  circle.setAttribute("r", "7");
  const motion = document.createElementNS(SVG_NS, "animateMotion");
  motion.setAttribute("path", d);
  motion.setAttribute("dur", "0.9s");
  motion.setAttribute("begin", "indefinite");
  motion.setAttribute("fill", "freeze");
  motion.setAttribute("calcMode", "spline");
  motion.setAttribute("keyTimes", "0;1");
  motion.setAttribute("keySplines", "0.4 0 0.2 1");
  circle.append(motion);
  line.after(circle);
  (motion as SVGAnimationElement).beginElement();
}

/** これより動かしたらドラッグ。小さな手ぶれはクリックのまま */
const DRAG_THRESHOLD_PX = 5;

/**
 * ドラッグ中のポインタ位置 y（画面座標）→ 落とす位置（何番目のステップの手前か。0..n）と、
 * その位置を示す横線の y（host 基準）。
 * ステップ名の上端どうしの間を、そのステップの「帯」とみなし、帯の中ほどより下なら後ろに入れる。
 * 畳んだ枠で描いていないステップがあっても、位置はステップの番号で返す（描いた k 番目の手前 = その番号の手前）。
 */
function dropAt(host: HTMLElement, clientY: number): { insertAt: number; lineY: number } | null {
  const tops = [...host.querySelectorAll(".messageText")].map((t) => t.getBoundingClientRect().top);
  if (tops.length === 0) return null;
  const spacing = tops.length > 1 ? (tops[tops.length - 1] - tops[0]) / (tops.length - 1) : 48;
  const bandEnd = (i: number) => (i + 1 < tops.length ? tops[i + 1] : tops[i] + spacing);
  const k = tops.filter((top, i) => (top + bandEnd(i)) / 2 < clientY).length;
  const boundary = k < tops.length ? tops[k] : bandEnd(tops.length - 1);
  // 最後に描いたステップの後ろ = その番号の後ろ（畳んだ枠が後ろにあれば、その手前）
  const insertAt = k < tops.length ? (numberAt(host, k) ?? k + 1) - 1 : (numberAt(host, k - 1) ?? k);
  return { insertAt, lineY: boundary - 6 - host.getBoundingClientRect().top };
}

/**
 * 点 y（画面座標）のある枠と場合。枠は図の上から何番目か（.labelBox の順 = drawnFrames の順）、
 * 場合は枠の中の点線の区切り（else）より下にいくつあるか。条件の文字（枠の見出しか else の条件）と、枠の囲みも返す。
 * どの枠の外なら null
 */
function frameAt(host: HTMLElement, y: number): { frame: number; arm: number; condition: string; rect: DOMRect } | null {
  const frames = [...host.querySelectorAll(".labelBox")].map((el) => el.closest('g[data-et="control-structure"]'));
  for (const [frame, g] of frames.entries()) {
    if (!g) continue;
    const rect = g.getBoundingClientRect();
    if (y < rect.top || y > rect.bottom) continue;
    // はじめの 4 本は囲み、残りは場合の区切り（drawLoop）
    const sections = [...g.querySelectorAll(":scope > line.loopLine")].slice(4);
    const arm = sections.filter((line) => line.getBoundingClientRect().top < y).length;
    const label = arm === 0 ? g.querySelector(".loopText") : g.querySelectorAll(".sectionTitle")[arm - 1];
    return { frame, arm, condition: label?.textContent?.trim() ?? "", rect };
  }
  return null;
}

/** すべての枠の囲み（画面座標）。枠の外に落とす横線を、枠にかからない位置へずらすのに使う */
function frameRects(host: HTMLElement): DOMRect[] {
  return [...host.querySelectorAll('g[data-et="control-structure"]')].map((g) => g.getBoundingClientRect());
}

/** 枠の条件の文字は小さいので、これだけ広げて当たりにする */
const COND_PAD_X = 40;
const COND_PAD_Y = 10;

type Box = { top: number; left: number; width: number; height: number };

/**
 * ドラッグ中のポインタが、場合の目印（空の場合の注記・枠の条件）の上にあれば、その目印と、
 * 囲みの位置（host 基準）。目印の順番は armOfTarget（lib/render/mermaid.ts）と揃える:
 * 条件は、枠の見出し（.loopText）が図の何番目の枠か、else の条件（.sectionTitle）が図全体で何番目か
 */
function armTargetAt(host: HTMLElement, x: number, y: number): { target: ArmTarget; box: Box } | null {
  const base = host.getBoundingClientRect();
  const hit = (el: Element, padX: number, padY: number): Box | null => {
    const r = el.getBoundingClientRect();
    if (x < r.left - padX || x > r.right + padX || y < r.top - padY || y > r.bottom + padY) return null;
    return { top: r.top - padY - base.top, left: r.left - padX - base.left, width: r.width + 2 * padX, height: r.height + 2 * padY };
  };
  for (const el of host.querySelectorAll(`[${PLACEHOLDER_ATTR}]`)) {
    const box = hit(el, 0, 0);
    if (box) return { target: { kind: "placeholder", k: Number(el.getAttribute(PLACEHOLDER_ATTR)) }, box };
  }
  const firsts = [...host.querySelectorAll(".loopText")];
  for (const [frame, el] of firsts.entries()) {
    const box = hit(el, COND_PAD_X, COND_PAD_Y);
    if (box) return { target: { kind: "first", frame }, box };
  }
  const elses = [...host.querySelectorAll(".sectionTitle")];
  for (const [index, el] of elses.entries()) {
    const box = hit(el, COND_PAD_X, COND_PAD_Y);
    if (box) return { target: { kind: "else", index }, box };
  }
  return null;
}

type Drag = { n: number; startY: number; pointerId: number; moving: boolean };

/**
 * 落とす先。ステップの間（横線）か、場合の中（囲み）。
 * ステップの間なら、落とした点のある枠と場合（inside。null = 枠の外）と、横線を引く範囲（host 基準）
 */
type Between = {
  insertAt: number;
  lineY: number;
  lineLeft?: number;
  lineWidth?: number;
  inside: { frame: number; arm: number; condition: string } | null;
};
type DropAt = Between | { arm: ArmTarget; box: Box };
type Drop = { n: number } & DropAt;

let renderSeq = 0;

/** 登場人物の名前と 2 段目（製品・サービス名）の間に足す間隔（px） */
const ACTOR_LINE_GAP = 6;

/** 中心の登場人物の色。塗りは半透明にして、明るい・暗いどちらの配色でも名前が読めるようにする */
const FOCUS_STROKE = "#d97706";
const FOCUS_FILL = "rgba(245, 158, 11, 0.22)";

/**
 * 登場人物の 2 段目（製品・サービス名。toMermaid が <br/> で分ける）を、名前から離し、小さく薄くする。
 * Mermaid は 1 段ずつ別の text.actor に描き、段の位置を tspan の dy で、大きさを style で直に書くので、
 * CSS ではなく SVG そのものを直す。変えたら true
 */
function spaceActorLines(doc: Document): boolean {
  let changed = false;
  for (const first of doc.querySelectorAll("text.actor")) {
    if (first.previousElementSibling?.matches("text.actor")) continue;
    const lines = [first];
    for (let el = first.nextElementSibling; el?.matches("text.actor"); el = el.nextElementSibling) lines.push(el);
    if (lines.length < 2) continue;
    lines.forEach((text, i) => {
      const tspan = text.querySelector("tspan");
      const dy = Number(tspan?.getAttribute("dy"));
      if (tspan && Number.isFinite(dy)) tspan.setAttribute("dy", String(dy + (i - (lines.length - 1) / 2) * ACTOR_LINE_GAP));
      if (i > 0 && text instanceof SVGElement) {
        text.style.setProperty("font-size", "12px");
        text.style.setProperty("opacity", "0.75");
      }
    });
    changed = true;
  }
  return changed;
}

/**
 * この業務の中心の登場人物（toMermaid が `%% focus: A3` で示す）の、頭（上下とも）とライフラインを色で強調し、
 * 名前を太字にする。Mermaid は登場人物の要素に name 属性で id を付けるので、それで見つける。
 * 色は Mermaid の <style> に勝つよう style で書く（再生中の強調は !important なので、そちらが勝つ）。変えたら true
 */
function markFocus(doc: Document, id: string): boolean {
  const named = `[name="${id}"]`;
  const paint = (el: Element, fill: boolean) => {
    if (!(el instanceof SVGElement)) return;
    el.style.setProperty("stroke", FOCUS_STROKE);
    el.style.setProperty("stroke-width", "2px");
    if (fill) el.style.setProperty("fill", FOCUS_FILL);
  };
  const bold = (head: Element | null) => {
    for (const t of head?.querySelectorAll("text.actor") ?? []) {
      if (t instanceof SVGElement) t.style.setProperty("font-weight", "700");
    }
  };
  let changed = false;
  for (const line of doc.querySelectorAll(`line.actor-line${named}`)) {
    paint(line, false);
    changed = true;
  }
  // 箱の登場人物（システム・社外）
  for (const rect of doc.querySelectorAll(`rect.actor${named}`)) {
    paint(rect, true);
    bold(rect.parentElement);
    changed = true;
  }
  // 人型の登場人物（部署・個人）
  for (const man of doc.querySelectorAll(`g.actor-man${named}`)) {
    for (const part of man.querySelectorAll("line, circle")) paint(part, part.tagName === "circle");
    bold(man);
    changed = true;
  }
  return changed;
}

/** 番号の黒丸の半径と、番号の文字の大きさ（Mermaid の既定より大きくして、手順の始まりを目立たせる） */
const STEP_DOT_R = 18;
const STEP_NUMBER_PX = 19;

/**
 * 番号の黒丸を、番号ごとの円にして大きくする。Mermaid は黒丸を全番号共通のマーカー（線の端の飾り）で
 * 描くので、大きさを変えられず、1 つだけ拡大することもできない。マーカーを外し、同じ位置に円と番号を
 * `<g class="step-dot">` にまとめる（拡大は CSS）。色は Mermaid がマーカーに付けた CSS の色を使う。変えたら true
 */
function enlargeStepDots(doc: Document): boolean {
  const css = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("");
  const fill = /\[id\$="-sequencenumber"\]\s*\{[^}]*?fill:\s*([^;}]+)/.exec(css)?.[1]?.trim() ?? "#333";
  let changed = false;
  for (const num of doc.querySelectorAll(".sequenceNumber")) {
    const line = num.previousElementSibling;
    if (!line || line.tagName !== "line" || !line.getAttribute("marker-start")) continue;
    const cx = line.getAttribute("x1") ?? "0";
    const cy = Number(line.getAttribute("y1") ?? 0);
    const g = doc.createElementNS(SVG_NS, "g");
    g.setAttribute("class", "step-dot");
    const circle = doc.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(STEP_DOT_R));
    circle.setAttribute("fill", fill);
    line.removeAttribute("marker-start");
    reshapeSelfLoop(line.previousElementSibling, Number(cx), cy);
    num.setAttribute("y", String(cy + STEP_NUMBER_PX * 0.36));
    num.setAttribute("font-size", String(STEP_NUMBER_PX));
    num.setAttribute("font-weight", "700");
    num.replaceWith(g);
    g.append(circle, num);
    changed = true;
  }
  return changed;
}

/**
 * 自分の中の作業の矢印（Mermaid は黒丸の中心から右へ 60・下へ 20 の小さな輪を描く）を、大きくした黒丸に
 * 隠れないように描き直す。黒丸の右端から出て、黒丸の下でライフラインに戻る、ひと回り大きな輪にする。
 * 矢じり（marker-end）は輪の終わりの向きで付くので、そのまま使える
 */
function reshapeSelfLoop(arrow: Element | null, cx: number, cy: number) {
  if (!arrow || arrow.tagName !== "path" || !arrow.getAttribute("class")?.includes("messageLine")) return;
  if (!/^M\s*[-\d.]+,[-\d.]+\s*C/.test(arrow.getAttribute("d") ?? "")) return;
  const r = STEP_DOT_R;
  const x0 = cx + r;
  const x1 = cx + r + 56;
  const end = cy + r + 12;
  arrow.setAttribute("d", `M ${x0},${cy} C ${x1},${cy - 16} ${x1},${end + 14} ${cx + 3},${end}`);
}

/**
 * Mermaid の SVG を、Mermaid の書き方では出せない見た目に整える（登場人物の 2 段目・中心の強調）。
 * 描くときに 1 回だけ直すので、画面にも、書き出す .svg にも同じように効く。読めなければ元のまま
 */
function polishSvg(svg: string, code: string): string {
  const focus = code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(FOCUS_COMMENT))
    ?.slice(FOCUS_COMMENT.length)
    .trim();
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (doc.querySelector("parsererror")) return svg;
  const dotted = enlargeStepDots(doc);
  const spaced = spaceActorLines(doc);
  const focused = focus !== undefined && /^\w+$/.test(focus) && markFocus(doc, focus);
  return dotted || spaced || focused ? new XMLSerializer().serializeToString(doc.documentElement) : svg;
}

/** Mermaid で描き、見た目を整える */
async function renderSvg(mermaid: MermaidApi, code: string): Promise<string> {
  renderSeq += 1;
  return polishSvg((await mermaid.render(`mermaid-${renderSeq}`, code)).svg, code);
}

/**
 * 画面に出さずに、Mermaid のコードを SVG にする（/editor で、枠を畳んでいても .svg は開いた図で書き出すため）。
 * 解釈できないコードなら null。
 */
export async function renderMermaidSvg(code: string): Promise<string | null> {
  const mermaid = await loadMermaid();
  if (!(await mermaid.parse(code, { suppressErrors: true }))) return null;
  return renderSvg(mermaid, code);
}

type Rendered = { for: string; svg: string };

/**
 * Mermaid のコードを SVG にして表示する。
 * - 「どのコードの SVG か」を持つので、古い結果かどうかをデータだけで判定できる
 * - パースに失敗しても、直前に成功した図は消さない（リアルタイムで育てる用途では、
 *   途中の不完全なコードで図が消えるのが最悪の体験）
 */
export function MermaidDiagram({
  code,
  onSvg,
  zoom,
  fill = false,
  onContainerRef,
  onPickStep,
  onMoveStep,
  onPickPlaceholder,
  onDropToArm,
  onCollapseFrame,
  onExpandFrame,
  onFrameNotes,
  highlightStep = 0,
  selectedStep = 0,
  notes,
  play,
}: {
  code: string;
  /** 指定すると、図の幅を表示領域の zoom 倍にする（全画面表示用。1 = 幅に合わせる） */
  zoom?: number;
  /** true なら、枠の罫線と余白を付けず、親の高さいっぱいに広げる */
  fill?: boolean;
  /** 描画に成功するたびに、SVG と、それがどのコードのものかを渡す（.svg の書き出し用） */
  onSvg?: (svg: string, forCode: string) => void;
  /** スクロールする外枠の DOM 要素を、親に渡す（全画面表示のパン・ズーム操作用） */
  onContainerRef?: (el: HTMLDivElement | null) => void;
  /** 図の番号・ステップ名をクリックしたら、その番号（1 始まり）を渡す。渡すと押せる見た目になる */
  onPickStep?: (n: number) => void;
  /**
   * 図の番号・ステップ名をドラッグして落としたら、動かしたステップ（0 始まり）と、
   * 落とした位置（移す前の並びで、何番目のステップの手前か）を渡す。渡すとドラッグできる
   */
  /** inside = 落とした点のある枠と場合（図の上から何番目の枠か・枠の中で何番目の場合か）。null = どの枠の外 */
  onMoveStep?: (index: number, insertAt: number, inside: { frame: number; arm: number } | null) => void;
  /** 空の場合の「＋ ここにステップを追加」を押したら、図の上から何番目（0 始まり）の注記かを渡す */
  onPickPlaceholder?: (k: number) => void;
  /**
   * ステップを、場合の目印（空の場合の注記・枠の条件）の上へドラッグして落としたら、動かしたステップ
   * （0 始まり）と目印を渡す。渡すと、ドラッグ中に目印が落とし先になる
   */
  onDropToArm?: (index: number, target: ArmTarget) => void;
  /** 枠の見出し（alt / opt / loop の札）を押したら、図に描いた枠の上から何番目（0 始まり）かを渡す（畳む） */
  onCollapseFrame?: (frame: number) => void;
  /** 畳んだ枠の注記（「▸ …」）を押したら、上から何番目（0 始まり）の注記かを渡す（開く） */
  onExpandFrame?: (k: number) => void;
  /**
   * 枠の付箋を開く。枠の見出しの札・畳んだ枠の注記を右クリックしたとき、枠の付箋の印を押したとき。
   * drawn = 図の上から何番目の枠か（drawnFrames の順）、folded = 何番目の「▸ …」の注記か（collapsedFrames の順）
   */
  onFrameNotes?: (at: { drawn: number } | { folded: number }) => void;
  /** 強調するステップの番号（1 始まり。0 なら強調しない）。音声で直しているステップを示す */
  highlightStep?: number;
  /** 編集パネルで選んでいるステップの番号（1 始まり。0 なら無し） */
  selectedStep?: number;
  /** 付箋のある手順・枠・登場人物（lib/model/notes.ts の noteMarks）。それぞれの横に印を付ける */
  notes?: NoteMarks;
  /** フローのプレビューで、今の場面に関わる要素を強調する（ほかは薄くする） */
  play?: PlayMark;
}) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const onSvgRef = useRef(onSvg);
  useEffect(() => {
    onSvgRef.current = onSvg;
  });
  const [failed, setFailed] = useState<{ for: string; message: string } | null>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  /** ドラッグを終えた直後の click は、ステップを選ぶ操作として扱わない */
  const suppressClickRef = useRef(false);
  const [drop, setDrop] = useState<Drop | null>(null);
  /** ポインタの位置の落とし先。場合の目印の上なら場合の中、そうでなければステップの間 */
  const dropTarget = (host: HTMLElement, x: number, y: number): DropAt | null => {
    const arm = onDropToArm ? armTargetAt(host, x, y) : null;
    if (arm) return { arm: arm.target, box: arm.box };
    const at = dropAt(host, y);
    if (!at) return null;
    const base = host.getBoundingClientRect();
    const inside = frameAt(host, y);
    let lineY = at.lineY + base.top;
    if (inside) {
      // 枠の中へ: 横線を枠の中に収め、枠の幅で引く
      const { rect, ...where } = inside;
      lineY = Math.min(Math.max(lineY, rect.top + 4), rect.bottom - 4);
      return {
        insertAt: at.insertAt,
        lineY: lineY - base.top,
        lineLeft: rect.left - base.left,
        lineWidth: rect.width,
        inside: where,
      };
    }
    // 枠の外へ: 横線が枠にかかるなら、ポインタのある側の枠の外へずらす
    const over = frameRects(host).find((r) => lineY >= r.top && lineY <= r.bottom);
    if (over) lineY = y > over.bottom ? over.bottom + 4 : over.top - 4;
    return { insertAt: at.insertAt, lineY: lineY - base.top, inside: null };
  };

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        // parse を先に通す。render に不正なコードを渡すと DOM にエラー要素が残ることがある
        const ok = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled) return;
        if (!ok) {
          setFailed({ for: code, message: "Mermaid の構文として解釈できません" });
          return;
        }
        const svg = await renderSvg(mermaid, code);
        if (cancelled) return;
        setRendered({ for: code, svg });
        setFailed(null);
        onSvgRef.current?.(svg, code);
      } catch (e) {
        if (cancelled) return;
        setFailed({ for: code, message: e instanceof Error ? e.message : "描画に失敗しました" });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code]);

  // 強調するステップが変わったら、見えるところまでスクロールする（見えていれば動かない）
  const shownFocusRef = useRef(0);

  // 付箋の印は、中身（番号と状態）が変わったときだけ付け直す（Map は毎回作り直される）
  const notesKey = notes
    ? [notes.steps, notes.frames, notes.actors, notes.folds]
        .map((m) => [...m].map(([k, st]) => `${k}${st[0]}`).join(","))
        .join("|")
    : "";
  // 描き直すたびに SVG が入れ替わるので、そのつど印を付け直す
  useEffect(() => {
    if (!svgHostRef.current) return;
    detachStepDots(svgHostRef.current);
    markPlaceholders(svgHostRef.current);
    markFrames(svgHostRef.current, onCollapseFrame !== undefined, onFrameNotes !== undefined);
    markStep(svgHostRef.current, FOCUS_ATTR, highlightStep);
    if (highlightStep !== shownFocusRef.current) {
      shownFocusRef.current = highlightStep;
      svgHostRef.current
        .querySelector(`[${FOCUS_ATTR}]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    markStep(svgHostRef.current, SELECTED_ATTR, selectedStep);
    markNotes(svgHostRef.current, notes);
    if (play) markPlay(svgHostRef.current, play);
    // onCollapseFrame は押せるかどうか（title を付けるか）だけを見る。毎回変わる関数でも描き直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, highlightStep, selectedStep, play, notesKey]);

  const endDrag = () => {
    dragRef.current = null;
    setDrop(null);
  };

  const current = failed?.for === code ? failed : null;
  const updating = rendered !== null && rendered.for !== code && current === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={onContainerRef}
        className={`min-h-0 flex-1 overflow-auto ${fill ? "" : "rounded-md border border-black/10 p-4 dark:border-white/15"}`}
      >
        {rendered ? (
          // 拡大の幅はこの外枠に付ける（ドラッグの線を、図の幅いっぱいに引くため）
          <div
            className="relative"
            style={zoom === undefined ? undefined : { width: `${zoom * 100}%`, margin: "0 auto" }}
          >
            <div
              ref={svgHostRef}
              className={`[&_svg]:mx-auto [&_svg]:h-auto transition-opacity ${MARK_CLASS} ${DOT_CLASS} ${onPickPlaceholder ? PLACEHOLDER_CLASS : ""} ${onCollapseFrame ? FRAME_CLASS : ""} ${PICKABLE_CLASS(onPickStep !== undefined)} ${
                onMoveStep ? MOVABLE_CLASS : ""
              } ${drop ? "select-none [&_*]:!cursor-grabbing" : ""} ${
                zoom === undefined ? "[&_svg]:max-w-full" : "[&_svg]:!w-full [&_svg]:!max-w-none"
              } ${updating ? "opacity-60" : "opacity-100"}`}
              onClick={(e) => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                // 枠の付箋の印は、枠を畳む・開くより先に（印は札・注記の中にある）
                const frameNote =
                  e.target instanceof Element ? e.target.closest(`[${FRAME_NOTE_ATTR}], [${FOLD_NOTE_ATTR}]`) : null;
                if (frameNote && onFrameNotes) {
                  const drawn = frameNote.getAttribute(FRAME_NOTE_ATTR);
                  const folded = Number(frameNote.getAttribute(FOLD_NOTE_ATTR));
                  onFrameNotes(drawn !== null ? { drawn: Number(drawn) } : { folded });
                  return;
                }
                const ph = e.target instanceof Element ? e.target.closest(`[${PLACEHOLDER_ATTR}]`) : null;
                if (ph && onPickPlaceholder) {
                  onPickPlaceholder(Number(ph.getAttribute(PLACEHOLDER_ATTR)));
                  return;
                }
                const folded = e.target instanceof Element ? e.target.closest(`[${COLLAPSED_ATTR}]`) : null;
                if (folded && onExpandFrame) {
                  onExpandFrame(Number(folded.getAttribute(COLLAPSED_ATTR)));
                  return;
                }
                const label = e.target instanceof Element ? e.target.closest(".labelText, .labelBox") : null;
                if (label && onCollapseFrame) {
                  const cls = label.classList.contains("labelText") ? ".labelText" : ".labelBox";
                  const frame = [...e.currentTarget.querySelectorAll(cls)].indexOf(label);
                  if (frame >= 0) onCollapseFrame(frame);
                  return;
                }
                const n = onPickStep ? stepAt(e.target) : null;
                if (n !== null) onPickStep?.(n);
              }}
              // 枠の見出しの札・畳んだ枠の注記を右クリックしたら、枠の付箋を開く（押すと畳む・開くのとは別に）
              onContextMenu={(e) => {
                if (!onFrameNotes || !(e.target instanceof Element)) return;
                const folded = e.target.closest(`[${COLLAPSED_ATTR}]`);
                if (folded) {
                  e.preventDefault();
                  onFrameNotes({ folded: Number(folded.getAttribute(COLLAPSED_ATTR)) });
                  return;
                }
                const label = e.target.closest(".labelText, .labelBox");
                if (!label) return;
                const cls = label.classList.contains("labelText") ? ".labelText" : ".labelBox";
                const frame = [...e.currentTarget.querySelectorAll(cls)].indexOf(label);
                if (frame < 0) return;
                e.preventDefault();
                onFrameNotes({ drawn: frame });
              }}
              onPointerDown={
                onMoveStep
                  ? (e) => {
                      if (e.button !== 0) return;
                      const n = stepAt(e.target);
                      if (n === null) return;
                      // 文字の選択が始まらないようにする（click は起きる）
                      e.preventDefault();
                      dragRef.current = { n, startY: e.clientY, pointerId: e.pointerId, moving: false };
                    }
                  : undefined
              }
              onPointerMove={(e) => {
                const drag = dragRef.current;
                const host = svgHostRef.current;
                if (!drag || !host || drag.pointerId !== e.pointerId) return;
                if (!drag.moving) {
                  if (Math.abs(e.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
                  drag.moving = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
                const at = dropTarget(host, e.clientX, e.clientY);
                if (at) setDrop({ n: drag.n, ...at });
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== e.pointerId) return;
                if (drag.moving) {
                  suppressClickRef.current = true;
                  const host = svgHostRef.current;
                  const at = host ? dropTarget(host, e.clientX, e.clientY) : null;
                  if (at && "arm" in at) onDropToArm?.(drag.n - 1, at.arm);
                  else if (at) onMoveStep?.(drag.n - 1, at.insertAt, at.inside && { frame: at.inside.frame, arm: at.inside.arm });
                }
                endDrag();
              }}
              onPointerCancel={endDrag}
              // securityLevel: "strict" の Mermaid が生成した SVG のみを入れる
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
            {drop && "arm" in drop && (
              <div
                aria-hidden
                className="pointer-events-none absolute rounded-md border-2 border-sky-500 bg-sky-500/10"
                style={drop.box}
              >
                <span className="absolute -top-3 left-1 whitespace-nowrap rounded bg-sky-500 px-1.5 text-xs text-white">
                  {drop.n} をこの場合の中へ
                </span>
              </div>
            )}
            {drop && "lineY" in drop && (
              <div
                aria-hidden
                className={`pointer-events-none absolute border-t-2 border-sky-500 ${drop.lineWidth === undefined ? "inset-x-0" : ""}`}
                style={{ top: drop.lineY, left: drop.lineLeft, width: drop.lineWidth }}
              >
                <span className="absolute -top-3 left-1 whitespace-nowrap rounded bg-sky-500 px-1.5 text-xs text-white">
                  {drop.inside ? `${drop.n} を ${drop.inside.condition || "この枠"} の中へ` : `${drop.n} をここへ`}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-zinc-500">{current ? "" : "図を描画しています…"}</p>
        )}
      </div>
      {current && (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {rendered ? "最新の内容は描画できないため、直前の図を表示しています。" : ""}
          {current.message}
        </p>
      )}
    </div>
  );
}
