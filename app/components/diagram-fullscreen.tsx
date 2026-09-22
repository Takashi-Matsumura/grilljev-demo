"use client";

import { useEffect, useRef, useState } from "react";
import { MermaidDiagram } from "./mermaid-diagram";

/**
 * ホワイトボード系アプリ（Figma・Miro など）の作法に揃えたパン・ズーム。
 *
 * - **⌘/Ctrl + ホイール**（トラックパッドのピンチも同じ扱い）: カーソルの位置を中心に拡大縮小
 * - **スペースを押しながらドラッグ**（または中央ボタンドラッグ）: 表示位置を移動
 * - 何も押さずにホイール／トラックパッド: そのままスクロール（ブラウザの標準動作）
 * - `+` / `-` / `0` キーと、右上のボタンでも操作できる
 *
 * ズームは「コンテナの幅に対する図の幅の倍率」（1 = 幅に合わせる）。パンは、実体としては
 * スクロール位置（scrollLeft/scrollTop）を直接動かしているだけ — 独自の座標系を持たない分、
 * ネイティブのスクロールバーやキーボードスクロールともケンカしない。
 */

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 6;
const BUTTON_STEP = 1.25;
/** ⌘/Ctrl+ホイール 1 回分の拡大率。deltaY が負（上スクロール・ピンチアウト）で拡大する */
const WHEEL_SENSITIVITY = 0.0025;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** ズームの基準点。ホイールはカーソル位置、ボタン・キーは表示領域の中心、リセットは左上に固定する */
type Anchor = { x: number; y: number } | "reset" | null;

export function FullscreenButton({ title, code, disabled }: { title: string; code: string; disabled: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const prevZoomRef = useRef(1);
  const anchorRef = useRef<Anchor>(null);

  const [spaceDown, setSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null);

  const zoomBy = (factor: number, clientX?: number, clientY?: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    anchorRef.current =
      clientX !== undefined && clientY !== undefined
        ? { x: clientX, y: clientY }
        : rect
          ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
          : null;
    setZoom((z) => clamp(round2(z * factor), ZOOM_MIN, ZOOM_MAX));
  };
  const resetZoom = () => {
    anchorRef.current = "reset";
    setZoom(1);
  };

  // ズームが変わったら、基準点が画面上で動かないようにスクロール位置を補正する。
  // svg の幅はコンテナ幅 × zoom なので、拡大率の比だけ中身のピクセル位置も一様に伸び縮みする。
  useEffect(() => {
    const el = containerRef.current;
    const anchor = anchorRef.current;
    const prevZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    anchorRef.current = null;
    if (!el || !anchor) return;
    if (anchor === "reset") {
      el.scrollLeft = 0;
      el.scrollTop = 0;
      return;
    }
    const rect = el.getBoundingClientRect();
    const ratio = zoom / prevZoom;
    const contentX = el.scrollLeft + (anchor.x - rect.left);
    const contentY = el.scrollTop + (anchor.y - rect.top);
    el.scrollLeft = contentX * ratio - (anchor.x - rect.left);
    el.scrollTop = contentY * ratio - (anchor.y - rect.top);
  }, [zoom]);

  // ⌘/Ctrl+ホイールでズーム。React の onWheel は passive で登録されて preventDefault が効かないため、
  // DOM に直接つける。押していないときは何もしない＝ブラウザ標準のスクロール（パン）に任せる。
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isOpen) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * WHEEL_SENSITIVITY);
      zoomBy(factor, e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isOpen]);

  // スペースキー押下中と、中央ボタンのドラッグで表示位置を動かす
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (!e.repeat) setSpaceDown(true);
        e.preventDefault();
      } else if (e.key === "+" || e.key === "=") {
        zoomBy(BUTTON_STEP);
        e.preventDefault();
      } else if (e.key === "-" || e.key === "_") {
        zoomBy(1 / BUTTON_STEP);
        e.preventDefault();
      } else if (e.key === "0") {
        resetZoom();
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    const onMove = (e: MouseEvent) => {
      const start = dragRef.current;
      const el = containerRef.current;
      if (!start || !el) return;
      el.scrollLeft = start.scrollLeft - (e.clientX - start.x);
      el.scrollTop = start.scrollTop - (e.clientY - start.y);
    };
    const onUp = () => {
      dragRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isOpen]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!spaceDown && e.button !== 1) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop };
    setIsPanning(true);
  };

  const btn =
    "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";

  return (
    <>
      <button
        type="button"
        className={btn}
        disabled={disabled}
        onClick={() => {
          setZoom(1);
          prevZoomRef.current = 1;
          setIsOpen(true);
          dialogRef.current?.showModal();
        }}
        title="図をウィンドウいっぱいに表示します（Esc で閉じる）"
      >
        ⛶ 全画面
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => {
          setIsOpen(false);
          setSpaceDown(false);
          setIsPanning(false);
          dragRef.current = null;
        }}
        className="m-0 h-dvh max-h-none w-screen max-w-none bg-white p-0 text-inherit backdrop:bg-black/60 dark:bg-zinc-900"
      >
        {/* 閉じている間は図を描画しない（同じ図を 2 か所で描かない） */}
        {isOpen && (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-black/10 px-4 py-2 dark:border-white/15">
              <h2 className="min-w-0 truncate font-medium">{title || "業務フロー図"}</h2>
              <p className="order-3 w-full text-xs text-zinc-500 sm:order-none sm:w-auto">
                ⌘/Ctrl+ホイールで拡大縮小・スペース+ドラッグで移動
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className={btn}
                  aria-label="縮小"
                  disabled={zoom <= ZOOM_MIN}
                  onClick={() => zoomBy(1 / BUTTON_STEP)}
                >
                  −
                </button>
                <button type="button" className={btn} title="幅に合わせる（0 キー）" onClick={resetZoom}>
                  {Math.round(zoom * 100)}%
                </button>
                <button
                  type="button"
                  className={btn}
                  aria-label="拡大"
                  disabled={zoom >= ZOOM_MAX}
                  onClick={() => zoomBy(BUTTON_STEP)}
                >
                  ＋
                </button>
                <button type="button" className={btn} onClick={() => dialogRef.current?.close()}>
                  閉じる（Esc）
                </button>
              </div>
            </div>
            <div
              className={`min-h-0 flex-1 p-4 ${spaceDown ? (isPanning ? "cursor-grabbing" : "cursor-grab") : ""} ${
                isPanning ? "select-none" : ""
              }`}
              onMouseDown={onMouseDown}
            >
              <MermaidDiagram code={code} zoom={zoom} fill onContainerRef={(el) => (containerRef.current = el)} />
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
