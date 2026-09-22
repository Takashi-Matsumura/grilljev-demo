"use client";

import { useMemo, useState } from "react";
import { buildAttention } from "@/lib/model/attention";
import { ISSUE_KIND_LABEL } from "@/lib/model/labels";
import type { FlowModel } from "@/lib/model/types";
import { hasDiagram, toMermaid, visibleSteps } from "@/lib/render/mermaid";
import { DiagramMeta } from "./diagram-meta";
import { DisclosureIcon } from "./disclosure-icon";
import { FullscreenButton } from "./diagram-fullscreen";
import { ExportButtons } from "./export-buttons";
import { MermaidDiagram } from "./mermaid-diagram";
import { SummaryButton } from "./summary-dialog";

const ISSUE_STATUS_LABEL: Record<string, string> = {
  open: "未確認",
  asked: "質問済み",
  parked: "保留",
};

/** 図を最後に更新したのが何か。 */
export type UpdateSource = "none" | "jev" | "manual";

export function DiagramPane({
  model,
  source,
  onDecideStep,
  devMode = false,
}: {
  model: FlowModel;
  source: UpdateSource;
  /** 仮のステップの承認・却下（過去の図では渡さない） */
  onDecideStep?: (id: string, decision: "approve" | "reject") => void;
  devMode?: boolean;
}) {
  const code = useMemo(() => toMermaid(model), [model]);
  const drawable = hasDiagram(model);
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const provisional = visibleSteps(model).filter((s) => s.status === "provisional");
  const openIssues = model.issues.filter((i) => i.status !== "answered");
  const attention = useMemo(() => buildAttention(model), [model]);
  // .svg の書き出し用。「どのコードの SVG か」を持ち、いまの図と一致するときだけ使う
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);
  const svgForExport = rendered && rendered.code === code ? rendered.svg : null;

  return (
    <section aria-label="業務フロー図" className="flex min-h-0 flex-1 flex-col">
      <DiagramMeta model={model} readiness={attention.readiness} source={source} devMode={devMode} />

      {/* 中段（可変・単独スクロール）: 図と、確認待ち・論点 */}
      <div className="flex min-h-[20rem] flex-1 flex-col gap-3 overflow-y-auto p-4 lg:min-h-0">
        <div className="min-h-[16rem] flex-1">
          {drawable ? (
            <MermaidDiagram code={code} onSvg={(svg, forCode) => setRendered({ svg, code: forCode })} />
          ) : (
            <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
              まだ図がありません。関係部署を設定して会話が始まると、ここに描かれます。
            </p>
          )}
        </div>

        {provisional.length > 0 && (
          <div className="shrink-0 max-h-32 overflow-y-auto rounded-md border border-amber-400/50 p-3">
            <h3 className="mb-1 text-sm font-medium">確認待ちのステップ（{provisional.length}）</h3>
            <ul className="flex flex-col gap-1 text-sm">
              {provisional.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 break-words">
                    {nameOf(s.from)} → {nameOf(s.to)}「{s.label}」
                    <span className="ml-1 text-xs text-zinc-400">
                      {devMode ? `確度 ${s.confidence.toFixed(2)}` : "確認が必要"}
                    </span>
                  </span>
                  {onDecideStep && (
                    <span className="flex shrink-0 gap-1">
                      <button
                        className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        onClick={() => onDecideStep(s.id, "approve")}
                      >
                        承認
                      </button>
                      <button
                        className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
                        onClick={() => onDecideStep(s.id, "reject")}
                      >
                        却下
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {openIssues.length > 0 && (
          <details className="group shrink-0 rounded-md border border-black/10 p-3 dark:border-white/15">
            <summary className="flex list-none cursor-pointer items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <DisclosureIcon />
              未解決の論点（{openIssues.length}）
            </summary>
            <ul className="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto text-sm">
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
          </details>
        )}

        {devMode && (
          <details className="group shrink-0 text-sm">
            <summary className="flex list-none cursor-pointer items-center gap-1.5 text-zinc-500 [&::-webkit-details-marker]:hidden">
              <DisclosureIcon />
              Mermaid コードを表示
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-white/10">
              {code}
            </pre>
          </details>
        )}
      </div>

      {/* 下段（固定）: 書き出し・業務分掌・全画面 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/10 px-4 py-2 dark:border-white/15">
        <ExportButtons model={model} mermaidCode={code} svg={svgForExport} empty={!drawable} />
        <SummaryButton model={model} empty={!drawable} />
        <FullscreenButton title={model.scope.title} code={code} disabled={!drawable} />
      </div>
    </section>
  );
}
