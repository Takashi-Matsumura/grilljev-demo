"use client";

import { useMemo, useState } from "react";
import { buildAttention } from "@/lib/model/attention";
import type { FlowModel, ModelOp, OpenIssue } from "@/lib/model/types";
import { hasDiagram, toMermaid, visibleSteps } from "@/lib/render/mermaid";
import { DiagramFooter } from "./diagram-footer";
import { DiagramMeta } from "./diagram-meta";
import { DisclosureIcon } from "./disclosure-icon";
import { FullscreenButton } from "./diagram-fullscreen";
import { FacilitatorOverlay } from "./facilitator-overlay";
import { MermaidDiagram } from "./mermaid-diagram";
import { RetractNotice } from "./retracted-steps";
import { StepEditDialog } from "./step-edit-dialog";

/** 図を最後に更新したのが何か。 */
export type UpdateSource = "none" | "jev" | "manual";

export type FacilitatorOverlayProps = {
  asked: OpenIssue;
  onAnswered: (issueId: string) => void;
  onPark: (issueId: string) => void;
  onNext: (issueId: string) => void;
};

export function DiagramPane({
  model,
  source,
  onDecideStep,
  onEditActors,
  onEditSteps,
  facilitator,
  focusStepId = null,
  onFocusStep,
  devMode = false,
}: {
  model: FlowModel;
  source: UpdateSource;
  /** 仮のステップの承認・却下（過去の図では渡さない） */
  onDecideStep?: (id: string, decision: "approve" | "reject") => void;
  /** 登場人物の手直し（過去の図では渡さない） */
  onEditActors?: (ops: ModelOp[]) => void;
  /** ステップの手直し（過去の図では渡さない）。渡すと、図の番号をクリックして編集できる */
  onEditSteps?: (ops: ModelOp[]) => void;
  /** 自動問いかけ ON かつ質問中のときだけ渡す。図の上にフローティングカードで出す */
  facilitator?: FacilitatorOverlayProps | null;
  /** 音声で直しているステップ。図で強調し、何を直しているかを帯で出す */
  focusStepId?: string | null;
  /** 音声で直すステップを切り替える（null で終える）。過去の図では渡さない */
  onFocusStep?: (id: string | null) => void;
  devMode?: boolean;
}) {
  const code = useMemo(() => toMermaid(model), [model]);
  // 図の番号をクリックして開いたステップ
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const pickStep = (n: number) => setEditingStep(visibleSteps(model)[n - 1]?.id ?? null);
  const drawable = hasDiagram(model);
  const steps = visibleSteps(model);
  const focusIndex = focusStepId ? steps.findIndex((s) => s.id === focusStepId) : -1;
  const focused = focusIndex >= 0 ? steps[focusIndex] : null;
  const attention = useMemo(() => buildAttention(model), [model]);
  // .svg の書き出し用。「どのコードの SVG か」を持ち、いまの図と一致するときだけ使う
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);
  const svgForExport = rendered && rendered.code === code ? rendered.svg : null;

  return (
    <section aria-label="業務フロー図" className="flex min-h-0 flex-1 flex-col">
      <DiagramMeta
        model={model}
        readiness={attention.readiness}
        source={source}
        onEditActors={onEditActors}
        devMode={devMode}
      />

      {/* 中段（可変・単独スクロール）: 図だけがここでスクロールする */}
      <div className="relative flex min-h-[20rem] flex-1 flex-col p-4 lg:min-h-0">
        {facilitator && (
          <FacilitatorOverlay
            asked={facilitator.asked}
            onAnswered={facilitator.onAnswered}
            onPark={facilitator.onPark}
            onNext={facilitator.onNext}
            devMode={devMode}
          />
        )}
        {onEditSteps && <RetractNotice model={model} onCommit={onEditSteps} />}
        {focused && (
          <div
            role="status"
            className="mb-2 mr-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <span>
              <span className="font-medium">
                {focusIndex + 1} 番「{focused.label}」
              </span>
              を直しています
            </span>
            <span className="text-xs text-amber-700 dark:text-amber-300/80">
              番号を言わずに直し方を話せます（例: 「渡すのはExcelのファイルです」「その前に確認が入ります」）。終わったら「OK」
            </span>
            {onFocusStep && (
              <button
                type="button"
                className="ml-auto rounded border border-amber-400 px-2 py-0.5 text-xs hover:bg-amber-100 dark:border-amber-500/50 dark:hover:bg-amber-500/20"
                onClick={() => onFocusStep(null)}
              >
                終える
              </button>
            )}
          </div>
        )}
        {drawable && (
          <div className="absolute right-6 top-6 z-10">
            <FullscreenButton title={model.scope.title} code={code} disabled={!drawable} compact />
          </div>
        )}
        <div className="min-h-0 flex-1">
          {drawable ? (
            <MermaidDiagram
              code={code}
              onSvg={(svg, forCode) => setRendered({ svg, code: forCode })}
              onPickStep={onEditSteps ? pickStep : undefined}
              highlightStep={focusIndex + 1}
            />
          ) : (
            <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
              {onEditActors
                ? "まだ図がありません。まず右上の丸いボタン（登場人物を登録）から、業務に関わる人・部署・システムを並べてください。会話の中で出てきた人も、ここに描かれます。"
                : "まだ図がありません。登場人物が登録されるか、会話の中で出てくると、ここに描かれます。"}
            </p>
          )}
        </div>

        {devMode && (
          <details className="group mt-3 shrink-0 text-sm">
            <summary className="flex list-none cursor-pointer items-center gap-1.5 text-zinc-500 [&::-webkit-details-marker]:hidden">
              <DisclosureIcon />
              Mermaid コードを表示
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 font-mono text-xs dark:bg-white/10">
              {code}
            </pre>
          </details>
        )}
      </div>

      <DiagramFooter
        model={model}
        attention={attention}
        mermaidCode={code}
        svg={svgForExport}
        empty={!drawable}
        onDecideStep={onDecideStep}
        onEditSteps={onEditSteps}
        devMode={devMode}
      />

      {onEditSteps && (
        <StepEditDialog
          model={model}
          stepId={editingStep}
          onClose={() => setEditingStep(null)}
          onCommit={onEditSteps}
          onFocus={onFocusStep}
        />
      )}
    </section>
  );
}
