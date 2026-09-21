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
}: {
  code: string;
  /** 指定すると、図の幅を表示領域の zoom 倍にする（全画面表示用。1 = 幅に合わせる） */
  zoom?: number;
  /** true なら、枠の罫線と余白を付けず、親の高さいっぱいに広げる */
  fill?: boolean;
  /** 描画に成功するたびに、SVG と、それがどのコードのものかを渡す（.svg の書き出し用） */
  onSvg?: (svg: string, forCode: string) => void;
}) {
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const onSvgRef = useRef(onSvg);
  useEffect(() => {
    onSvgRef.current = onSvg;
  });
  const [failed, setFailed] = useState<{ for: string; message: string } | null>(null);

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

  const current = failed?.for === code ? failed : null;
  const updating = rendered !== null && rendered.for !== code && current === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        className={`min-h-0 flex-1 overflow-auto ${fill ? "" : "rounded-md border border-black/10 p-4 dark:border-white/15"}`}
      >
        {rendered ? (
          <div
            className={`[&_svg]:mx-auto [&_svg]:h-auto transition-opacity ${
              zoom === undefined ? "[&_svg]:max-w-full" : "[&_svg]:!w-full [&_svg]:!max-w-none"
            } ${updating ? "opacity-60" : "opacity-100"}`}
            style={zoom === undefined ? undefined : { width: `${zoom * 100}%`, margin: "0 auto" }}
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
