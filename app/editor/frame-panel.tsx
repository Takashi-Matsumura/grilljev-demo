"use client";

import { NotesSection } from "@/app/components/notes-section";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { KIND_TEXT } from "./branch-section";

/**
 * 枠（分岐）の付箋のパネル（/editor の右側）。図の枠の見出しの札を右クリックする・札の横の付箋の印を押すと開く。
 * 枠の中の手順を選ばなくても、分岐の見分け方・くり返しを終える基準などを、枠に直接貼れるようにする
 */
export function FramePanel({
  model,
  groupId,
  onCommit,
  onClose,
}: {
  model: FlowModel;
  /** 枠（Branch.groupId） */
  groupId: string;
  onCommit: (ops: ModelOp[]) => void;
  onClose: () => void;
}) {
  const arms = model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
  if (arms.length === 0) return null;
  const kind = arms[0].kind;
  return (
    <aside
      aria-label="枠の付箋"
      className="flex shrink-0 flex-col border-t border-black/10 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium">枠の付箋</h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="mx-4 mb-3 mt-2 rounded-md border border-dashed border-violet-300 bg-violet-50/60 px-3 py-2 dark:border-violet-400/40 dark:bg-violet-400/10">
        <p className="text-xs text-violet-800 dark:text-violet-200">{KIND_TEXT[kind].title}</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">
          {arms.map((b) => (
            <li key={b.id}>
              {KIND_TEXT[kind].before}［{b.condition.trim() || "（条件が未入力）"}］{KIND_TEXT[kind].after}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
        <NotesSection model={model} target={{ kind: "frame", id: groupId }} onCommit={onCommit} />
      </div>
    </aside>
  );
}
