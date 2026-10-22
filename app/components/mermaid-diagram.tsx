"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayMark } from "@/lib/preview/scenes";
import { COLLAPSED_MARK, PLACEHOLDER_TEXT, type ArmTarget } from "@/lib/render/mermaid";

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
    ? "[&_.messageText]:cursor-pointer [&_.step-dot]:cursor-pointer [&_.messageText:hover]:fill-sky-600 [&_.messageText:hover]:underline [&_.step-dot:hover]:scale-160"
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
 * `<g class="step-dot">` にまとめる（拡大は CSS）。描いた SVG に手を加えるだけなので、書き出す図には入らない。
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
function markFrames(root: HTMLElement, foldable: boolean) {
  let k = 0;
  for (const text of root.querySelectorAll(".noteText")) {
    if (!text.textContent?.trim().startsWith(COLLAPSED_MARK)) continue;
    text.parentElement?.setAttribute(COLLAPSED_ATTR, String(k));
    addTitle(text.parentElement, "押すと枠を開きます");
    k += 1;
  }
  if (!foldable) return;
  for (const el of root.querySelectorAll(".labelText, .labelBox")) addTitle(el, "押すと枠を畳みます");
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

/** 落とす先。ステップの間（横線）か、場合の中（囲み） */
type DropAt = { insertAt: number; lineY: number } | { arm: ArmTarget; box: Box };
type Drop = { n: number } & DropAt;

let renderSeq = 0;

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
  highlightStep = 0,
  selectedStep = 0,
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
  onMoveStep?: (index: number, insertAt: number) => void;
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
  /** 強調するステップの番号（1 始まり。0 なら強調しない）。音声で直しているステップを示す */
  highlightStep?: number;
  /** 編集パネルで選んでいるステップの番号（1 始まり。0 なら無し） */
  selectedStep?: number;
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
    return arm ? { arm: arm.target, box: arm.box } : dropAt(host, y);
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
        renderSeq += 1;
        const { svg } = await mermaid.render(`mermaid-${renderSeq}`, code);
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

  // 描き直すたびに SVG が入れ替わるので、そのつど印を付け直す
  useEffect(() => {
    if (!svgHostRef.current) return;
    detachStepDots(svgHostRef.current);
    markPlaceholders(svgHostRef.current);
    markFrames(svgHostRef.current, onCollapseFrame !== undefined);
    markStep(svgHostRef.current, FOCUS_ATTR, highlightStep);
    if (highlightStep !== shownFocusRef.current) {
      shownFocusRef.current = highlightStep;
      svgHostRef.current
        .querySelector(`[${FOCUS_ATTR}]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
    markStep(svgHostRef.current, SELECTED_ATTR, selectedStep);
    if (play) markPlay(svgHostRef.current, play);
    // onCollapseFrame は押せるかどうか（title を付けるか）だけを見る。毎回変わる関数でも描き直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rendered, highlightStep, selectedStep, play]);

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
                  else if (at) onMoveStep?.(drag.n - 1, at.insertAt);
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
                className="pointer-events-none absolute inset-x-0 border-t-2 border-sky-500"
                style={{ top: drop.lineY }}
              >
                <span className="absolute -top-3 left-1 rounded bg-sky-500 px-1.5 text-xs text-white">
                  {drop.n} をここへ
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
