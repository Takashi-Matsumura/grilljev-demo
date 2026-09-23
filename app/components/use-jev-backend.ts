"use client";

import { useCallback, useSyncExternalStore } from "react";
import { JEV_BACKEND_COOKIE, parseJevBackend, type JevBackend } from "@/lib/jev-backend";

/**
 * 判定器の送り先（TypeSafe の Jev / ローカル判定器）。
 *
 * Route Handler が読めるよう `localStorage` ではなく cookie に置く（lib/jev.ts の
 * `currentJevBackend`）。操作する場所（バックエンドの状態ダイアログ）と説明文を出す場所
 * （Studio 配下のトグル）が別の React ツリーにいるので、`useFacilitatorAuto` と同じ作法で同期する。
 *
 * `fallback` は cookie が無いときの値。サーバが cookie と `JEV_BACKEND` から決めた値を
 * そのまま渡すこと（サーバ描画とハイドレーションの結果をそろえるため）。
 */

const MAX_AGE_SEC = 365 * 24 * 60 * 60;

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function readCookie(): JevBackend | null {
  const hit = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${JEV_BACKEND_COOKIE}=`));
  return parseJevBackend(hit?.slice(JEV_BACKEND_COOKIE.length + 1));
}

export function useJevBackend(fallback: JevBackend): [JevBackend, (next: JevBackend) => void] {
  const backend = useSyncExternalStore(
    subscribe,
    () => readCookie() ?? fallback,
    () => fallback,
  );

  const setBackend = useCallback((next: JevBackend) => {
    document.cookie = `${JEV_BACKEND_COOKIE}=${next}; path=/; max-age=${MAX_AGE_SEC}; samesite=lax`;
    for (const listener of listeners) listener();
  }, []);

  return [backend, setBackend];
}
