"use client";

import { useMemo, useState } from "react";
import { buildAttention } from "@/lib/model/attention";
import type { FlowModel } from "@/lib/model/types";
import { hasDiagram, toMermaid } from "@/lib/render/mermaid";
import { DiagramFooter } from "./diagram-footer";
import { DiagramMeta } from "./diagram-meta";
import { DisclosureIcon } from "./disclosure-icon";
import { FullscreenButton } from "./diagram-fullscreen";
import { MermaidDiagram } from "./mermaid-diagram";

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
  const attention = useMemo(() => buildAttention(model), [model]);
  // .svg の書き出し用。「どのコードの SVG か」を持ち、いまの図と一致するときだけ使う
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);
  const svgForExport = rendered && rendered.code === code ? rendered.svg : null;

  return (
    <section aria-label="業務フロー図" className="flex min-h-0 flex-1 flex-col">
      <DiagramMeta model={model} readiness={attention.readiness} source={source} devMode={devMode} />

      {/* 中段（可変・単独スクロール）: 図だけがここでスクロールする */}
      <div className="relative flex min-h-[20rem] flex-1 flex-col p-4 lg:min-h-0">
        {drawable && (
          <div className="absolute right-6 top-6 z-10">
            <FullscreenButton title={model.scope.title} code={code} disabled={!drawable} compact />
          </div>
        )}
        <div className="min-h-0 flex-1">
          {drawable ? (
            <MermaidDiagram code={code} onSvg={(svg, forCode) => setRendered({ svg, code: forCode })} />
          ) : (
            <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
              まだ図がありません。関係部署を設定して会話が始まると、ここに描かれます。
            </p>
          )}
        </div>

        {devMode && (
          <details className="group mt-3 shrink-0 text-sm">
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

      <DiagramFooter
        model={model}
        attention={attention}
        mermaidCode={code}
        svg={svgForExport}
        empty={!drawable}
        onDecideStep={onDecideStep}
        devMode={devMode}
      />
    </section>
  );
}
