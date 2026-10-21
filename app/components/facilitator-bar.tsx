"use client";

import { ISSUE_KIND_LABEL } from "@/lib/model/labels";
import type { OpenIssue } from "@/lib/model/types";

const BTN =
  "rounded-md border border-violet-300 px-2.5 py-1 text-xs hover:bg-violet-100 dark:border-violet-500/40 dark:hover:bg-violet-500/20";

/**
 * ファシリテーターの問いを、業務フロー図の上（図の外）に帯で出す。
 * 図に重ねない: 問いが出ている間も、図を見ながら答えたり、ステップを手直ししたりできるようにする。
 * 自動問いかけ（バックエンドの状態ダイアログのトグル）が ON で、いま出している問い
 * （model.issues の status === "asked"）があるときだけ、呼び出し側が描画する。
 */
export function FacilitatorBar({
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
    <div
      role="alert"
      aria-label="ファシリテーターからの問いかけ"
      className="mb-2 flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border border-violet-300 bg-violet-50 px-3 py-2 dark:border-violet-500/40 dark:bg-violet-950/60"
    >
      <div className="flex min-w-0 flex-1 basis-80 items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-violet-200 px-1.5 text-xs leading-5 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100">
          {ISSUE_KIND_LABEL[asked.kind]}
        </span>
        <div className="min-w-0">
          <p className="break-words font-medium">{asked.prompt.text}</p>
          {asked.prompt.suggestedAnswer && (
            <p className="break-words text-xs text-zinc-600 dark:text-zinc-400">
              <span className="text-zinc-500">推奨回答（仮）: </span>
              {asked.prompt.suggestedAnswer}
            </p>
          )}
          {devMode && (asked.ignored ?? 0) > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              答えないまま話が進みました（{asked.ignored}/2）。もう一度進むと保留にします。
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
  );
}
