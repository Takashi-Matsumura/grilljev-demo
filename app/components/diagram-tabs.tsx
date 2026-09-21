"use client";

import type { ArchivedDiagram } from "@/lib/scope/apply";

type Props = {
  archives: ArchivedDiagram[];
  currentTitle: string;
  /** "current" か、過去の図の id */
  viewId: string;
  onView: (id: string) => void;
};

/** 「図を分ける」で増える図のタブ。過去の図は読み取り専用。図が 1 つだけなら出さない。 */
export function DiagramTabs({ archives, currentTitle, viewId, onView }: Props) {
  if (archives.length === 0) return null;
  const tab = (id: string, label: string, sub?: string) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={viewId === id}
      onClick={() => onView(id)}
      className={`max-w-[14rem] shrink-0 truncate rounded-t-md border border-b-0 px-3 py-1.5 text-sm ${
        viewId === id
          ? "border-black/15 bg-background font-medium dark:border-white/20"
          : "border-transparent text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
      }`}
      title={label}
    >
      {label}
      {sub && <span className="ml-1 text-xs text-zinc-400">{sub}</span>}
    </button>
  );

  return (
    <div
      role="tablist"
      aria-label="業務フロー図"
      className="flex gap-1 overflow-x-auto border-b border-black/10 px-4 pt-2 dark:border-white/15"
    >
      {archives.map((a) => tab(a.id, a.title || "（未設定）", "過去"))}
      {tab("current", currentTitle || "（未設定）", "現在")}
    </div>
  );
}
