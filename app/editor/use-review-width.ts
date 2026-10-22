"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * フローの点検（/editor の右パネル）の幅（px）。`null` は「既定（w-96）」を意味する。
 *
 * `useLeftWidth`（app/components/use-left-width.ts）と同じ作法: `localStorage` に覚えさせ、
 * `useSyncExternalStore` でサーバーの描画を必ず既定値（null）にし、
 * クライアントでは保存値を読む。他のタブとも `storage` イベントで同期する。
 */

const KEY = "grilljev:reviewWidth";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function getServerSnapshot(): number | null {
  return null;
}

export function useReviewWidth(): [number | null, (next: number | null) => void] {
  const width = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setWidth = useCallback((next: number | null) => {
    try {
      if (next === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, String(Math.round(next)));
    } catch {
      // プライベートウィンドウ等で書けないときは、この操作は諦める
    }
    for (const listener of listeners) listener();
  }, []);

  return [width, setWidth];
}
