"use client";

import { useState } from "react";
import { PanelSection } from "@/app/components/step-panel";
import { conditionPrefix } from "@/lib/model/branch";
import type { Branch, FlowModel } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";
import { KIND_TEXT } from "./branch-section";

/**
 * 分岐（枠）を先に作るフォーム（「＋ 分岐を追加」）。ステップの追加と同じ場所（図の右、狭い画面では下）に出す。
 * 種類と条件だけを決めて空の枠を作り、中のステップはあとから場合ごとに足す。
 * 「もし〜なら」は最初から条件を 2 つ出す（「そうでなければ」まで一度に作れるように）。
 */
export function BranchAddPanel({
  model,
  afterStepId,
  onCreate,
  onClose,
}: {
  model: FlowModel;
  /** このステップの直後に作る（そのステップが枠の中なら、枠の直後）。null なら図の最後 */
  afterStepId: string | null;
  onCreate: (kind: Branch["kind"], conditions: string[]) => void;
  onClose: () => void;
}) {
  const steps = visibleSteps(model);
  const afterIndex = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : -1;
  const after = afterIndex >= 0 ? steps[afterIndex] : undefined;
  // 条件の書き出し。直前のステップの結果で分かれることが多いので、そのステップ名を主語にしておく
  const prefix = after ? conditionPrefix(after.label) : "";
  const [kind, setKind] = useState<Branch["kind"]>("alt");
  const [conditions, setConditions] = useState<string[]>([prefix, prefix]);
  const used = kind === "alt" ? conditions : conditions.slice(0, 1);
  const filled = (c: string) => c.trim() !== "" && c.trim() !== prefix.trim();
  const ready = used.every(filled);
  const position = after ? `${afterIndex + 1} 番の後に作ります` : "図の最後に作ります";
  const text = KIND_TEXT[kind];
  const submit = () => {
    if (ready) onCreate(kind, used);
  };
  const setAt = (i: number, value: string) => setConditions((cs) => cs.map((c, k) => (k === i ? value : c)));

  return (
    <aside
      aria-label="分岐の追加"
      className="flex shrink-0 flex-col border-t border-black/10 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium">分岐の追加</h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="px-4 pb-2 text-xs text-zinc-500" title="図の番号を選んでから追加すると、その後に作ります">
        {position}
      </p>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        // 変換を確定する Enter で作らない（Safari は変換中の Enter でもフォームを送る）
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-2">
          <PanelSection title="どんな分岐ですか？">
            {(Object.keys(KIND_TEXT) as Branch["kind"][]).map((k) => (
              <label
                key={k}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-black/15 px-3 py-2 has-[:checked]:border-sky-500 has-[:checked]:bg-sky-50 dark:border-white/20 dark:has-[:checked]:bg-sky-500/10"
              >
                <input type="radio" name="frame-kind" className="mt-1" checked={kind === k} onChange={() => setKind(k)} />
                <span className="flex flex-col">
                  <span className="text-sm">{KIND_TEXT[k].title}</span>
                  <span className="text-xs text-zinc-500">{KIND_TEXT[k].example}</span>
                </span>
              </label>
            ))}
          </PanelSection>

          <PanelSection title={kind === "alt" ? "場合ごとの条件" : "条件"}>
            {used.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5">
                {(i > 0 || text.before) && (
                  <span className="shrink-0 text-xs">{i > 0 ? "そうでなく" : text.before}</span>
                )}
                <input
                  autoFocus={i === 0}
                  aria-label={`${i + 1} つ目の条件`}
                  className="w-full min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20"
                  value={c}
                  placeholder={kind === "loop" ? "不備がなくなるまで" : i === 0 ? "不備がある" : "不備がない"}
                  onFocus={(e) => {
                    const n = e.currentTarget.value.length;
                    e.currentTarget.setSelectionRange(n, n);
                  }}
                  onChange={(e) => setAt(i, e.target.value)}
                />
                <span className="shrink-0 text-xs">{text.after}</span>
                {kind === "alt" && used.length > 2 && (
                  <button
                    type="button"
                    aria-label={`${i + 1} つ目の場合を消す`}
                    className="shrink-0 rounded px-1 text-zinc-400 hover:bg-black/5 hover:text-zinc-600 dark:hover:bg-white/10"
                    onClick={() => setConditions((cs) => cs.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {kind === "alt" && (
              <button
                type="button"
                className="w-fit rounded-md px-2 py-1 text-xs text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10"
                onClick={() => setConditions((cs) => [...cs, prefix])}
              >
                ＋ 場合を足す
              </button>
            )}
            <p className="text-xs text-zinc-500">中のステップは、作ったあとに場合ごとに足します。</p>
          </PanelSection>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/10 px-4 py-3 dark:border-white/15">
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40 disabled:hover:bg-sky-600"
            disabled={!ready}
          >
            分岐を作る
          </button>
        </div>
      </form>
    </aside>
  );
}
