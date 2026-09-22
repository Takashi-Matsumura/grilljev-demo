"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * ファシリテーターの「自動問いかける」ON/OFF。
 *
 * 操作する場所（バックエンドの状態ダイアログ、health-dialog.tsx）と、使う場所
 * （Studio 配下の useFacilitator）が別々の React ツリーにいる（page.tsx の
 * Server Component を挟む）ため、`useDevMode`（use-dev-mode.ts）と同じ作法で
 * `localStorage` を介して共有する。既定は ON（従来の初期値と同じ）。
 */

const KEY = "grilljev:facilitatorAuto";

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
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

function getServerSnapshot(): boolean {
  return true;
}

export function useFacilitatorAuto(): [boolean, (next: boolean) => void] {
  const auto = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setAuto = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // プライベートウィンドウ等で書けないときは、この操作は諦める
    }
    for (const listener of listeners) listener();
  }, []);

  return [auto, setAuto];
}
