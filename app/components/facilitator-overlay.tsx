"use client";

import { ISSUE_KIND_LABEL } from "@/lib/model/labels";
import type { OpenIssue } from "@/lib/model/types";

const BTN =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";

/**
 * ファシリテーターの問いを、業務フロー図の上に浮かせて出すフローティングカード。
 * 自動問いかけ（バックエンドの状態ダイアログのトグル）が ON で、いま出している問い
 * （model.issues の status === "asked"）があるときだけ、呼び出し側が描画する。
 */
export function FacilitatorOverlay({
  asked,
  devMode = false,
  onAnswered,
  onPark,
  onNext,
}: {
  asked: OpenIssue;
  devMode?: boolean;
  onAnswered: (issueId: string) => void;
  onPark: (issueId: string) => void;
  /** 保留にして、別の問いを出す */
  onNext: (issueId: string) => void;
}) {
  if (!asked.prompt) return null;

  return (
    <div className="pointer-events-none absolute inset-x-4 top-16 z-20 flex justify-center">
      <div
        role="alert"
        aria-label="ファシリテーターからの問いかけ"
        className="pointer-events-auto w-full max-w-xl rounded-lg border border-violet-300 bg-violet-50/95 p-4 shadow-xl backdrop-blur-sm dark:border-violet-500/40 dark:bg-violet-950/90"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 rounded bg-violet-200 px-1.5 text-xs leading-5 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100">
            {ISSUE_KIND_LABEL[asked.kind]}
          </span>
          <p className="min-w-0 break-words text-base font-medium">{asked.prompt.text}</p>
        </div>
        {asked.prompt.suggestedAnswer && (
          <p className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-400">
            <span className="text-zinc-500">推奨回答（仮）: </span>
            {asked.prompt.suggestedAnswer}
          </p>
        )}
        {devMode && (asked.ignored ?? 0) > 0 && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            答えないまま話が進みました（{asked.ignored}/2）。もう一度進むと保留にします。
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={BTN} onClick={() => onAnswered(asked.id)}>
            答えた
          </button>
          <button type="button" className={BTN} onClick={() => onPark(asked.id)}>
            保留にする
          </button>
          <button type="button" className={BTN} onClick={() => onNext(asked.id)}>
            別の問いにする
          </button>
        </div>
      </div>
    </div>
  );
}
