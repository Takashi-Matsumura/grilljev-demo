"use client";

import { useEffect, useRef, useState } from "react";

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
    ? "[&_.messageText]:cursor-pointer [&_.sequenceNumber]:cursor-pointer [&_.messageText:hover]:fill-sky-600 [&_.messageText:hover]:underline"
    : "";

/**
 * クリックした要素から、図の何番目のステップかを割り出す。
 * 番号（.sequenceNumber）はその数字を、ステップ名（.messageText）は図の中での出現順を使う。
 * Mermaid はメッセージを図の上から順に描くので、出現順がそのまま autonumber と一致する。
 */
function pickStep(target: EventTarget, onPick: (n: number) => void) {
  if (!(target instanceof Element)) return;
  const num = target.closest(".sequenceNumber");
  if (num) {
    const n = Number(num.textContent?.trim());
    if (Number.isInteger(n) && n > 0) onPick(n);
    return;
  }
  const text = target.closest(".messageText");
  const svg = text?.closest("svg");
  if (!text || !svg) return;
  const n = [...svg.querySelectorAll(".messageText")].indexOf(text) + 1;
  if (n > 0) onPick(n);
}
/** 強調している番号・ステップ名に付ける印。CSS で色を変える */
const FOCUS_ATTR = "data-focus";
const FOCUS_CLASS =
  "[&_.messageText[data-focus]]:!fill-amber-600 [&_.messageText[data-focus]]:font-bold [&_.sequenceNumber[data-focus]]:!fill-amber-600 dark:[&_.messageText[data-focus]]:!fill-amber-400";

/**
 * n 番目（1 始まり）のステップの番号とステップ名に印を付ける（0 なら外す）。
 * 図のコードは変えずに描いた SVG へ印を付けるので、書き出す図には入らない。
 */
function markStep(root: HTMLElement, n: number) {
  for (const el of root.querySelectorAll(`[${FOCUS_ATTR}]`)) el.removeAttribute(FOCUS_ATTR);
  if (n <= 0) return;
  root.querySelectorAll(".messageText")[n - 1]?.setAttribute(FOCUS_ATTR, "");
  for (const num of root.querySelectorAll(".sequenceNumber")) {
    if (Number(num.textContent?.trim()) === n) num.setAttribute(FOCUS_ATTR, "");
  }
}

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
  highlightStep = 0,
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
  /** 強調するステップの番号（1 始まり。0 なら強調しない）。音声で直しているステップを示す */
  highlightStep?: number;
}) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const onSvgRef = useRef(onSvg);
  useEffect(() => {
    onSvgRef.current = onSvg;
  });
  const [failed, setFailed] = useState<{ for: string; message: string } | null>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);

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
    if (svgHostRef.current) markStep(svgHostRef.current, highlightStep);
  }, [rendered, highlightStep]);

  const current = failed?.for === code ? failed : null;
  const updating = rendered !== null && rendered.for !== code && current === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={onContainerRef}
        className={`min-h-0 flex-1 overflow-auto ${fill ? "" : "rounded-md border border-black/10 p-4 dark:border-white/15"}`}
      >
        {rendered ? (
          <div
            ref={svgHostRef}
            className={`[&_svg]:mx-auto [&_svg]:h-auto transition-opacity ${FOCUS_CLASS} ${PICKABLE_CLASS(onPickStep !== undefined)} ${
              zoom === undefined ? "[&_svg]:max-w-full" : "[&_svg]:!w-full [&_svg]:!max-w-none"
            } ${updating ? "opacity-60" : "opacity-100"}`}
            style={zoom === undefined ? undefined : { width: `${zoom * 100}%`, margin: "0 auto" }}
            onClick={onPickStep ? (e) => pickStep(e.target, onPickStep) : undefined}
            // securityLevel: "strict" の Mermaid が生成した SVG のみを入れる
            dangerouslySetInnerHTML={{ __html: rendered.svg }}
          />
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
