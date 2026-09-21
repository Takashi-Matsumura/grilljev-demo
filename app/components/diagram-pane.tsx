"use client";

import { useMemo } from "react";
import type { FlowModel } from "@/lib/model/types";
import { hasDiagram, toMermaid } from "@/lib/render/mermaid";
import { MermaidDiagram } from "./mermaid-diagram";

const ISSUE_KIND_LABEL: Record<string, string> = {
  purpose: "目的",
  who: "担当",
  when: "時期",
  criteria: "基準",
  exception: "例外",
  tool: "道具",
  handoff: "引継ぎ",
};

const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: "未確認",
  asked: "質問済み",
  parked: "保留",
};

/** 図を最後に更新したのが何か。台本は固定の変更であり、jev の判定ではない。 */
export type UpdateSource = "none" | "script" | "jev" | "manual";

const SOURCE_BADGE: Record<UpdateSource, { text: string; cls: string }> = {
  none: {
    text: "更新なし",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  },
  script: {
    text: "直近の更新: 台本（固定・jev の判定ではない）",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  },
  jev: {
    text: "直近の更新: jev の判定",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  manual: {
    text: "直近の更新: 手動操作",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  },
};

export function DiagramPane({ model, source }: { model: FlowModel; source: UpdateSource }) {
  const code = useMemo(() => toMermaid(model), [model]);
  const drawable = hasDiagram(model);
  const openIssues = model.issues.filter((i) => i.status !== "answered");
  const badge = SOURCE_BADGE[source];

  return (
    <section className="flex min-h-[32rem] flex-1 flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-medium">業務フロー図</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.text}</span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500">対象業務</dt>
        <dd className="min-w-0 break-words">
          {model.scope.title || "（未設定）"}
          <span className="ml-2 text-xs tabular-nums text-zinc-400">rev.{model.rev}</span>
        </dd>
        <dt className="text-zinc-500">目的</dt>
        <dd className="min-w-0 break-words">
          {model.scope.purpose || <span className="text-zinc-400">（未確定）</span>}
        </dd>
      </dl>

      <div className="min-h-0 flex-1">
        {drawable ? (
          <MermaidDiagram code={code} />
        ) : (
          <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
            まだ図がありません。関係部署を設定して会話が始まると、ここに描かれます。
          </p>
        )}
      </div>

      {openIssues.length > 0 && (
        <div className="max-h-28 overflow-y-auto rounded-md border border-black/10 p-3 dark:border-white/15">
          <h3 className="mb-1 text-sm font-medium">未解決の論点（{openIssues.length}）</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {openIssues.map((i) => (
              <li key={i.id} className="flex gap-2">
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 text-xs leading-5 text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
                  {ISSUE_KIND_LABEL[i.kind] ?? i.kind}
                </span>
                <span className="min-w-0 break-words">{i.question}</span>
                <span className="ml-auto shrink-0 text-xs text-zinc-400">
                  {ISSUE_STATUS_LABEL[i.status] ?? i.status}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Mermaid コードを表示</summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-white/10">
          {code}
        </pre>
      </details>
    </section>
  );
}
