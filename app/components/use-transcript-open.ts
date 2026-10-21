"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 文字起こしの列を開いているか。既定は閉じた（細い列）。会議の進行中に見るのは図で、
 * 文字起こしの行は、確かめたいとき（判定の中身・デバッグ）にだけ開いて見る。
 *
 * このブラウザに `localStorage` で覚えさせる（既定は閉じた状態）。
 * `useSyncExternalStore` を使い、サーバーでの描画は必ず false（`getServerSnapshot`）にし、
 * クライアントでは保存値を読む。トグルは `storage` イベント経由で他のタブとも同期する。
 */

const KEY = "grilljev:transcriptOpen";

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function getServerSnapshot(): boolean {
  return false;
}

export function useTranscriptOpen(): [boolean, (next: boolean) => void] {
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setOpen = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // プライベートウィンドウ等で書けないときは、この操作は諦める
    }
    for (const listener of listeners) listener();
  }, []);

  return [open, setOpen];
}
