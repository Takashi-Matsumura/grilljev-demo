"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** ホイール 1 目盛り（deltaY ≈ 100）で約 18% 変わる */
const SPEED = 0.002;
/** 100% の近くは 100%（幅に合わせる）に吸い付かせる。小さい図を拡大しない状態に戻れるように */
const SNAP = 0.04;

/** スクロール位置を合わせるための、拡大縮小する直前の状態 */
type Anchor = { x: number; y: number; left: number; top: number; width: number; height: number };

/**
 * ⌘（または Ctrl）を押しながらのスクロールで、図を拡大縮小する。トラックパッドのピンチも同じ扱い
 * （ブラウザは ctrlKey 付きの wheel として送ってくる）。
 * マウスの下にある図の位置が動かないように、拡大縮小のあとでスクロール位置を合わせる。
 *
 * zoom は 1 = 幅に合わせる。それ以外は表示領域の幅に対する倍率（MermaidDiagram の zoom）。
 */
export function useWheelZoom() {
  const [zoom, setZoom] = useState(1);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const anchorRef = useRef<Anchor | null>(null);

  useEffect(() => {
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      // ブラウザのページ全体の拡大（Ctrl・ピンチ）を止める。passive: false が要る
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      const rect = el.getBoundingClientRect();
      anchorRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        left: el.scrollLeft,
        top: el.scrollTop,
        width: el.scrollWidth,
        height: el.scrollHeight,
      };
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-delta * SPEED)));
        return Math.abs(next - 1) < SNAP ? 1 : Math.round(next * 100) / 100;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [el]);

  // 図の幅が変わった直後（描画前）に、マウスの下の位置が保たれるようスクロールし直す
  useLayoutEffect(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!el || !a) return;
    const rx = el.scrollWidth / a.width;
    const ry = el.scrollHeight / a.height;
    el.scrollTo({ left: (a.left + a.x) * rx - a.x, top: (a.top + a.y) * ry - a.y });
  }, [el, zoom]);

  return { zoom, setZoom, containerRef: setEl };
}
