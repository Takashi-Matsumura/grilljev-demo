"use client";

import { useEffect, useRef, useState } from "react";
import { PLACEHOLDER_TEXT } from "@/lib/render/mermaid";

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
 * 要素から、図の何番目（1 始まり）のステップかを割り出す。ステップの番号・名前でなければ null。
 * 番号（.sequenceNumber）はその数字を、ステップ名（.messageText）は図の中での出現順を使う。
 * Mermaid はメッセージを図の上から順に描くので、出現順がそのまま autonumber と一致する。
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
  const n = [...svg.querySelectorAll(".messageText")].indexOf(text) + 1;
  return n > 0 ? n : null;
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

/** 空の場合の注記の見た目（押せる、点線の枠） */
const PLACEHOLDER_CLASS = [
  "[&_[data-placeholder]]:cursor-pointer",
  "[&_[data-placeholder]_rect]:!fill-sky-50 [&_[data-placeholder]_rect]:!stroke-sky-500 [&_[data-placeholder]_rect]:[stroke-dasharray:4_3]",
  "[&_[data-placeholder]:hover_rect]:!fill-sky-100 [&_[data-placeholder]_text]:!fill-sky-700",
  "dark:[&_[data-placeholder]_rect]:!fill-sky-500/10 dark:[&_[data-placeholder]_text]:!fill-sky-300",
].join(" ");

/** n 番目（1 始まり）のステップ名に印を付ける（0 なら外す） */
function markStep(root: HTMLElement, attr: string, n: number) {
  for (const el of root.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
  if (n > 0) root.querySelectorAll(".messageText")[n - 1]?.setAttribute(attr, "");
}

/** これより動かしたらドラッグ。小さな手ぶれはクリックのまま */
const DRAG_THRESHOLD_PX = 5;

/**
 * ドラッグ中のポインタ位置 y（画面座標）→ 落とす位置（何番目のステップの手前か。0..n）と、
 * その位置を示す横線の y（host 基準）。
 * ステップ名の上端どうしの間を、そのステップの「帯」とみなし、帯の中ほどより下なら後ろに入れる。
 */
function dropAt(host: HTMLElement, clientY: number): { insertAt: number; lineY: number } | null {
  const tops = [...host.querySelectorAll(".messageText")].map((t) => t.getBoundingClientRect().top);
  if (tops.length === 0) return null;
  const spacing = tops.length > 1 ? (tops[tops.length - 1] - tops[0]) / (tops.length - 1) : 48;
  const bandEnd = (i: number) => (i + 1 < tops.length ? tops[i + 1] : tops[i] + spacing);
  const insertAt = tops.filter((top, i) => (top + bandEnd(i)) / 2 < clientY).length;
  const boundary = insertAt < tops.length ? tops[insertAt] : bandEnd(tops.length - 1);
  return { insertAt, lineY: boundary - 6 - host.getBoundingClientRect().top };
}

type Drag = { n: number; startY: number; pointerId: number; moving: boolean };

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
  highlightStep = 0,
  selectedStep = 0,
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
  /** 強調するステップの番号（1 始まり。0 なら強調しない）。音声で直しているステップを示す */
  highlightStep?: number;
  /** 編集パネルで選んでいるステップの番号（1 始まり。0 なら無し） */
  selectedStep?: number;
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
  const [drop, setDrop] = useState<{ n: number; insertAt: number; lineY: number } | null>(null);

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

  // 描き直すたびに SVG が入れ替わるので、そのつど印を付け直す
  useEffect(() => {
    if (!svgHostRef.current) return;
    detachStepDots(svgHostRef.current);
    markPlaceholders(svgHostRef.current);
    markStep(svgHostRef.current, FOCUS_ATTR, highlightStep);
    markStep(svgHostRef.current, SELECTED_ATTR, selectedStep);
  }, [rendered, highlightStep, selectedStep]);

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
              className={`[&_svg]:mx-auto [&_svg]:h-auto transition-opacity ${MARK_CLASS} ${DOT_CLASS} ${onPickPlaceholder ? PLACEHOLDER_CLASS : ""} ${PICKABLE_CLASS(onPickStep !== undefined)} ${
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
                const at = dropAt(host, e.clientY);
                if (at) setDrop({ n: drag.n, ...at });
              }}
              onPointerUp={(e) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== e.pointerId) return;
                if (drag.moving) {
                  suppressClickRef.current = true;
                  const host = svgHostRef.current;
                  const at = host ? dropAt(host, e.clientY) : null;
                  if (at) onMoveStep?.(drag.n - 1, at.insertAt);
                }
                endDrag();
              }}
              onPointerCancel={endDrag}
              // securityLevel: "strict" の Mermaid が生成した SVG のみを入れる
              dangerouslySetInnerHTML={{ __html: rendered.svg }}
            />
            {drop && (
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
