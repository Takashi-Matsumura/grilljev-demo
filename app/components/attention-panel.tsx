"use client";

import type { AttentionItem, Attention } from "@/lib/model/attention";
import { ISSUE_KIND_LABEL, STEP_FLAG_LABEL } from "@/lib/model/labels";

const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: "未確認",
  parked: "保留",
};

const DECIDE_BTN =
  "rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";

/**
 * 確認待ちのステップと未解決の論点を1つに統合した「要対応」リスト。
 * 「いま出している問い」（status: "asked"）は FacilitatorPane のカードが持つので、
 * ここには来ない（lib/model/attention.ts の buildAttention を参照）。
 */
export function AttentionPanel({
  items,
  flags,
  onDecideStep,
  devMode = false,
}: {
  items: AttentionItem[];
  flags: Attention["flags"];
  /** 仮のステップの承認・却下（過去の図では渡さない） */
  onDecideStep?: (id: string, decision: "approve" | "reject") => void;
  devMode?: boolean;
}) {
  const flagEntries = (Object.entries(flags) as [keyof typeof flags, number][]).filter(
    ([, count]) => count > 0,
  );

  return (
    <div className="flex flex-col gap-2 text-sm">
      {!onDecideStep && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">過去の図なので操作できません</p>
      )}
      {items.length === 0 ? (
        <p className="text-zinc-500 dark:text-zinc-400">いま要対応の項目はありません。</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) =>
            item.kind === "step" ? (
              <li key={`step-${item.id}`} className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-amber-100 px-1.5 text-xs leading-5 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
                  確認待ち
                </span>
                <span className="min-w-0 flex-1 break-words">
                  {item.from} → {item.to}「{item.step.label}」
                  <span className="ml-1 text-xs text-zinc-400">
                    {devMode ? `確度 ${item.step.confidence.toFixed(2)}` : "確認が必要"}
                  </span>
                </span>
                {onDecideStep && (
                  <span className="flex shrink-0 gap-1">
                    <button className={DECIDE_BTN} onClick={() => onDecideStep(item.id, "approve")}>
                      承認
                    </button>
                    <button className={DECIDE_BTN} onClick={() => onDecideStep(item.id, "reject")}>
                      却下
                    </button>
                  </span>
                )}
              </li>
            ) : (
              <li key={`issue-${item.id}`} className="flex gap-2">
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs leading-5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                  {ISSUE_KIND_LABEL[item.issue.kind] ?? item.issue.kind}
                </span>
                <span className="min-w-0 break-words">{item.issue.question}</span>
                <span className="ml-auto shrink-0 text-xs text-zinc-400">
                  {ISSUE_STATUS_LABEL[item.issue.status] ?? item.issue.status}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      {flagEntries.length > 0 && (
        <p className="border-t border-black/10 pt-2 text-xs text-zinc-500 dark:border-white/15 dark:text-zinc-400">
          掘り下げ軸:{" "}
          {flagEntries.map(([key, count], i) => (
            <span key={key}>
              {i > 0 && " ・ "}
              {STEP_FLAG_LABEL[key]} {count}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
