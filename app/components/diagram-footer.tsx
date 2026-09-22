"use client";

import type { Attention } from "@/lib/model/attention";
import type { FlowModel } from "@/lib/model/types";
import { AttentionPanel } from "./attention-panel";
import { DisclosureIcon } from "./disclosure-icon";
import { ExportButtons } from "./export-buttons";
import { SummaryButton } from "./summary-dialog";

const ATTENTION_BADGE = "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300";

/**
 * 右カラム下段の固定バー。要対応（承認/却下・未解決の論点）は上向きに開く
 * ポップオーバーに収め、書き出しは ExportButtons のメニューに任せる。
 */
export function DiagramFooter({
  model,
  attention,
  mermaidCode,
  svg,
  empty,
  onDecideStep,
  devMode = false,
}: {
  model: FlowModel;
  attention: Attention;
  mermaidCode: string;
  svg: string | null;
  empty: boolean;
  onDecideStep?: (id: string, decision: "approve" | "reject") => void;
  devMode?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/10 px-4 py-2 dark:border-white/15">
      {attention.total > 0 ? (
        <details className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 [&::-webkit-details-marker]:hidden dark:border-white/20 dark:hover:bg-white/10">
            <DisclosureIcon />
            要対応 <span className={`rounded px-1.5 py-0.5 text-xs ${ATTENTION_BADGE}`}>{attention.total}</span>
          </summary>
          <div className="absolute bottom-full left-0 z-10 mb-1 w-[min(34rem,calc(100vw-2rem))] max-h-[min(60vh,22rem)] overflow-y-auto rounded-md border border-black/15 bg-background p-2 shadow-lg dark:border-white/20">
            <AttentionPanel
              items={attention.items}
              flags={attention.flags}
              onDecideStep={onDecideStep}
              devMode={devMode}
            />
          </div>
        </details>
      ) : (
        <span className="text-sm text-zinc-500 dark:text-zinc-400">要対応 0</span>
      )}
      <SummaryButton model={model} empty={empty} />
      <ExportButtons model={model} mermaidCode={mermaidCode} svg={svg} empty={empty} />
    </div>
  );
}
