"use client";

import { useRef, useState } from "react";
import { MermaidDiagram } from "./mermaid-diagram";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3];

/**
 * 図をウィンドウいっぱいに表示する。<dialog> のモーダルなので、Esc で閉じられ、
 * 背後の画面は操作できない。図は幅に合わせて表示し、拡大・縮小とスクロールで細部を見られる。
 */
export function FullscreenButton({ title, code, disabled }: { title: string; code: string; disabled: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [zoomIdx, setZoomIdx] = useState(2);

  const btn =
    "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";

  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => {
          setZoomIdx(2);
          setIsOpen(true);
          ref.current?.showModal();
        }}
        title="図をウィンドウいっぱいに表示します（Esc で閉じる）"
      >
        ⛶ 全画面
      </button>
      <dialog
        ref={ref}
        onClose={() => setIsOpen(false)}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-inherit backdrop:bg-black/60 dark:bg-zinc-900"
      >
        {/* 閉じている間は図を描画しない（同じ図を 2 か所で描かない） */}
        {isOpen && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-2 dark:border-white/15">
              <h2 className="min-w-0 truncate font-medium">{title || "業務フロー図"}</h2>
              <div className="flex shrink-0 items-center gap-2">
                <button type="button" className={btn} aria-label="縮小" disabled={zoomIdx === 0} onClick={() => setZoomIdx((i) => i - 1)}>
                  −
                </button>
                <button type="button" className={btn} title="幅に合わせる" onClick={() => setZoomIdx(2)}>
                  {Math.round(ZOOM_STEPS[zoomIdx] * 100)}%
                </button>
                <button type="button" className={btn} aria-label="拡大" disabled={zoomIdx === ZOOM_STEPS.length - 1} onClick={() => setZoomIdx((i) => i + 1)}>
                  ＋
                </button>
                <button type="button" className={btn} onClick={() => ref.current?.close()}>
                  閉じる（Esc）
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 p-4">
              <MermaidDiagram code={code} zoom={ZOOM_STEPS[zoomIdx]} fill />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
