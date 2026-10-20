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
  devMode?: boolean;
}) {
  const code = useMemo(() => toMermaid(model), [model]);
  // 図の番号をクリックして開いたステップ
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const pickStep = (n: number) => setEditingStep(visibleSteps(model)[n - 1]?.id ?? null);
  const drawable = hasDiagram(model);
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
        devMode={devMode}
      />

      {onEditSteps && (
        <StepEditDialog
          model={model}
          stepId={editingStep}
          onClose={() => setEditingStep(null)}
          onCommit={onEditSteps}
        />
      )}
    </section>
  );
}
