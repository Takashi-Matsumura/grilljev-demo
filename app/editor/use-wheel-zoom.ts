"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** ホイール 1 目盛り（deltaY ≈ 100）で約 18% 変わる */
const SPEED = 0.002;
/** 100% の近くは 100%（幅に合わせる）に吸い付かせる。小さい図を拡大しない状態に戻れるように */
const SNAP = 0.04;

/** Space + ドラッグで動かし始めたときの、ポインタとスクロールの位置 */
type Pan = { pointerId: number; x: number; y: number; left: number; top: number };

/** Space を文字として打つ場所（ここでは図を動かすモードにしない） */
const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** スクロール位置を合わせるための、拡大縮小する直前の状態 */
type Anchor = { x: number; y: number; left: number; top: number; width: number; height: number };

/**
 * ⌘（または Ctrl）を押しながらのスクロールで、図を拡大縮小する。トラックパッドのピンチも同じ扱い
 * （ブラウザは ctrlKey 付きの wheel として送ってくる）。Space を押しながらドラッグすると、図を動かす。
 * マウスの下にある図の位置が動かないように、拡大縮小のあとでスクロール位置を合わせる。
 *
 * zoom は 1 = 幅に合わせる。それ以外は表示領域の幅に対する倍率（MermaidDiagram の zoom）。
 */
export function useWheelZoom() {
  const [zoom, setZoom] = useState(1);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const anchorRef = useRef<Anchor | null>(null);
  /** Space を押していて、図を掴める状態か。掴んでいる間は grabbing */
  const [hand, setHand] = useState<"off" | "grab" | "grabbing">("off");

  // Space + ドラッグで図を動かす。図の上にマウスがあるときだけ Space を奪う
  // （ほかの場所では、ボタンを押す・ページをスクロールするといった本来の動きのままにする）
  useEffect(() => {
    if (!el) return;
    let hovering = false;
    let space = false;
    let pan: Pan | null = null;
    const update = () => setHand(pan ? "grabbing" : space ? "grab" : "off");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target) || (!hovering && !pan)) return;
      e.preventDefault();
      if (!space) {
        space = true;
        update();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !space) return;
      space = false;
      update();
    };
    const onBlur = () => {
      space = false;
      pan = null;
      update();
    };
    const onEnter = () => {
      hovering = true;
    };
    const onLeave = () => {
      hovering = false;
    };
    // キャプチャで受けて止める。図のステップの選択・ドラッグ（並べ替え）を始めさせない
    const onPointerDown = (e: PointerEvent) => {
      if (!space || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      pan = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      update();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.pointerId) return;
      e.stopPropagation();
      el.scrollTo({ left: pan.left - (e.clientX - pan.x), top: pan.top - (e.clientY - pan.y) });
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.pointerId) return;
      e.stopPropagation();
      pan = null;
      update();
    };
    // 動かし終えたときの click で、ステップの編集が開かないようにする
    const onClick = (e: MouseEvent) => {
      if (space) e.stopPropagation();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    el.addEventListener("pointerenter", onEnter);
    el.addEventListener("pointerleave", onLeave);
    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("pointermove", onPointerMove, true);
    el.addEventListener("pointerup", onPointerUp, true);
    el.addEventListener("pointercancel", onPointerUp, true);
    el.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("pointermove", onPointerMove, true);
      el.removeEventListener("pointerup", onPointerUp, true);
      el.removeEventListener("pointercancel", onPointerUp, true);
      el.removeEventListener("click", onClick, true);
    };
  }, [el]);

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

  return { zoom, setZoom, containerRef: setEl, hand };
}
