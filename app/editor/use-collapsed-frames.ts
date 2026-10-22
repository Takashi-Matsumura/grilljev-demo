"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * /editor の図で畳んでいる枠（Branch.groupId）。図ごとに、このブラウザの `localStorage` に覚えさせる。
 * 畳むのは画面の見え方だけなので、図のデータ（FlowModel）には入れない。
 *
 * `useReviewWidth`（use-review-width.ts）と同じ作法: `useSyncExternalStore` でサーバーの描画を必ず
 * 「何も畳まない」にし、クライアントでは保存値を読む。他のタブとも `storage` イベントで同期する。
 */

const PREFIX = "grilljev:collapsed:";

const EMPTY: ReadonlySet<string> = new Set();

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

// useSyncExternalStore は同じ値なら同じ参照を返す必要があるので、読んだ文字列ごとに Set を覚えておく
const parsed = new Map<string, ReadonlySet<string>>();

function read(key: string): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return EMPTY;
    let set = parsed.get(raw);
    if (!set) {
      const ids: unknown = JSON.parse(raw);
      set = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
      parsed.set(raw, set);
    }
    return set;
  } catch {
    return EMPTY;
  }
}

export function useCollapsedFrames(slug: string): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const key = PREFIX + slug;
  const collapsed = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY,
  );

  const setCollapsed = useCallback(
    (next: ReadonlySet<string>) => {
      try {
        if (next.size === 0) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // プライベートウィンドウ等で書けないときは、この操作は諦める
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [collapsed, setCollapsed];
}
