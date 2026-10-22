"use client";

import { useEffect, useRef } from "react";

/**
 * 浮かせて開く <details>（書き出し・削除したステップ）を、外側をクリックしたとき・Esc で閉じる。
 * 返す ref を <details> に付ける。開いているときだけ見張る。
 */
export function useCloseOnOutside() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const details = ref.current;
      if (details?.open && !details.contains(e.target as Node)) details.open = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const details = ref.current;
      if (e.key !== "Escape" || !details?.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);
  return ref;
}
