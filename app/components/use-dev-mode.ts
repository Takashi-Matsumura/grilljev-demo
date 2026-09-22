"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * 「開発者モード」— 確度・rev・トークン数・生JSON・Jevコンソール・開発用サンプルなど、
 * 会議の進行には要らない内部情報の出し入れを、まとめて切り替える 1 つのスイッチ。
 *
 * このブラウザに `localStorage` で覚えさせる（既定は OFF = 本番向けのすっきりした画面）。
 * `useSyncExternalStore` を使い、サーバーでの描画は必ず false（`getServerSnapshot`）にし、
 * クライアントでは保存値を読む。トグルは `storage` イベント経由で他のタブとも同期する。
 */

const KEY = "grilljev:devMode";

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

export function useDevMode(): [boolean, (next: boolean) => void] {
  const devMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setDevMode = useCallback((next: boolean) => {
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // プライベートウィンドウ等で書けないときは、この操作は諦める
    }
    for (const listener of listeners) listener();
  }, []);

  return [devMode, setDevMode];
}
