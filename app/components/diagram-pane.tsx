"use client";

import { useMemo, useState } from "react";
import { ISSUE_KIND_LABEL } from "@/lib/model/labels";
import type { FlowModel } from "@/lib/model/types";
import { hasDiagram, toMermaid, visibleSteps } from "@/lib/render/mermaid";
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

/** 開発者モード: 何によって更新されたかの内訳。本番向けは、更新があったかどうかだけ伝える。 */
const SOURCE_BADGE_DEV: Record<UpdateSource, { text: string; cls: string }> = {
  none: {
    text: "更新なし",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  },
  jev: {
    text: "直近の更新: Jev の判定",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  manual: {
    text: "直近の更新: 手動操作",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  },
};

const SOURCE_BADGE_PLAIN: Record<UpdateSource, { text: string; cls: string }> = {
  none: SOURCE_BADGE_DEV.none,
  jev: { text: "更新あり", cls: SOURCE_BADGE_DEV.jev.cls },
  manual: { text: "更新あり", cls: SOURCE_BADGE_DEV.manual.cls },
};

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
  const badge = (devMode ? SOURCE_BADGE_DEV : SOURCE_BADGE_PLAIN)[source];
  // .svg の書き出し用。「どのコードの SVG か」を持ち、いまの図と一致するときだけ使う
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);
  const svgForExport = rendered && rendered.code === code ? rendered.svg : null;

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
          {devMode && <span className="ml-2 text-xs tabular-nums text-zinc-400">rev.{model.rev}</span>}
        </dd>
        <dt className="text-zinc-500">目的</dt>
        <dd className="min-w-0 break-words">
          {model.scope.purpose || <span className="text-zinc-400">（未確定）</span>}
        </dd>
      </dl>

      <div className="min-h-0 flex-1">
        {drawable ? (
          <MermaidDiagram code={code} onSvg={(svg, forCode) => setRendered({ svg, code: forCode })} />
        ) : (
          <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
            まだ図がありません。関係部署を設定して会話が始まると、ここに描かれます。
          </p>
        )}
      </div>

      {provisional.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-md border border-amber-400/50 p-3">
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
        <details className="group rounded-md border border-black/10 p-3 dark:border-white/15">
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExportButtons model={model} mermaidCode={code} svg={svgForExport} empty={!drawable} />
        <SummaryButton model={model} empty={!drawable} />
        <FullscreenButton title={model.scope.title} code={code} disabled={!drawable} />
      </div>

      {devMode && (
        <details className="group text-sm">
          <summary className="flex list-none cursor-pointer items-center gap-1.5 text-zinc-500 [&::-webkit-details-marker]:hidden">
            <DisclosureIcon />
            Mermaid コードを表示
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-zinc-100 p-3 text-xs dark:bg-white/10">
            {code}
          </pre>
        </details>
      )}
    </section>
  );
}
