"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActorEditDialog } from "@/app/components/actor-edit-dialog";
import { ExportButtons } from "@/app/components/export-buttons";
import { MermaidDiagram } from "@/app/components/mermaid-diagram";
import { RetractedSteps, RetractNotice } from "@/app/components/retracted-steps";
import { StepPanel } from "@/app/components/step-panel";
import { addStepOp, type StepInput } from "@/lib/model/add-step";
import { moveStepOps } from "@/lib/model/move";
import { applyOps } from "@/lib/model/reducer";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { hasDiagram, toMermaid, visibleSteps } from "@/lib/render/mermaid";
import { BranchSection } from "./branch-section";
import { StepAddPanel } from "./step-add-panel";
import { useDiagramAutosave } from "./use-diagram-autosave";
import { useWheelZoom } from "./use-wheel-zoom";

/** 元に戻せる回数 */
const MAX_HISTORY = 100;

type History = { past: FlowModel[]; present: FlowModel; future: FlowModel[] };

/** 右側のパネル。ステップの編集か、ステップの追加 */
type Panel =
  | { mode: "edit"; stepId: string }
  | { mode: "add"; afterStepId: string | null; initialFrom?: string; seq: number }
  | null;

const SAVE_LABEL = { saved: "保存済み", saving: "保存中…", error: "保存できていません" } as const;

/**
 * 手で業務フロー図を描くエディタ（/editor/[slug]）。
 *
 * 図の変更はすべて ModelOp にして applyOps に通す（会議画面と同じ入口）。
 * 後で音声から操作するときは、同じ ops を作る経路を足せばよい。
 * applyOps は純粋関数なので、元に戻す / やり直しはモデルを丸ごと積んで実現する。
 */
export function Editor({ slug, name, initial }: { slug: string; name: string; initial: FlowModel }) {
  const [history, setHistory] = useState<History>({ past: [], present: initial, future: [] });
  const model = history.present;
  const status = useDiagramAutosave(slug, model);
  const [panel, setPanel] = useState<Panel>(null);
  const { zoom, setZoom, containerRef } = useWheelZoom();
  const [showAssignees, setShowAssignees] = useState(false);
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);

  const commit = useCallback((ops: ModelOp[]) => {
    setHistory((h) => {
      const next = applyOps(h.present, ops, new Date().toISOString());
      if (next === h.present) return h;
      return { past: [...h.past, h.present].slice(-MAX_HISTORY), present: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => {
    setHistory((h) =>
      h.past.length === 0
        ? h
        : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] },
    );
  }, []);
  const redo = useCallback(() => {
    setHistory((h) =>
      h.future.length === 0
        ? h
        : { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) },
    );
  }, []);

  // ⌘Z / ⇧⌘Z（Ctrl も可）。文字を入力している欄では、ブラウザの文字の取り消しに任せる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z" || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // 書き出し（.mmd・.drawio）は担当者を付けないコード。画面の図（.svg）は表示どおり
  const code = useMemo(() => toMermaid(model), [model]);
  const hasAssignees = model.steps.some((s) => s.status !== "retracted" && s.assignee);
  const displayCode = useMemo(
    () => (showAssignees ? toMermaid(model, { assignees: true }) : code),
    [code, model, showAssignees],
  );
  const svgForExport = rendered && rendered.code === displayCode ? rendered.svg : null;
  const drawable = hasDiagram(model);
  const steps = visibleSteps(model);

  // 消えた（削除・元に戻した）ステップは選んでいないことにする
  const editingIndex = panel?.mode === "edit" ? steps.findIndex((s) => s.id === panel.stepId) : -1;
  const afterIndex = panel?.mode === "add" && panel.afterStepId ? steps.findIndex((s) => s.id === panel.afterStepId) : -1;
  const selectedIndex = editingIndex >= 0 ? editingIndex : afterIndex;

  const pickStep = (n: number) => {
    const id = steps[n - 1]?.id;
    if (!id) return;
    // 追加フォームを開いているときは、入れる位置を選び直す
    setPanel((p) => (p?.mode === "add" ? { ...p, afterStepId: id } : { mode: "edit", stepId: id }));
  };
  const moveStep = (index: number, insertAt: number) => {
    const ops = moveStepOps(steps, index, insertAt);
    if (ops.length === 0) return;
    commit(ops);
    setPanel({ mode: "edit", stepId: steps[index].id });
  };
  const openAdd = () =>
    setPanel((p) => ({
      mode: "add",
      afterStepId: p?.mode === "edit" && editingIndex >= 0 ? p.stepId : null,
      seq: (p?.mode === "add" ? p.seq : 0) + 1,
    }));
  const addStep = (input: StepInput, again: boolean) => {
    const afterStepId = panel?.mode === "add" ? panel.afterStepId : null;
    const op = addStepOp(model, input, afterStepId);
    if (op.op !== "step.add") return;
    commit([op]);
    const id = op.step.id;
    setPanel(
      again
        ? { mode: "add", afterStepId: id, initialFrom: input.to, seq: (panel?.mode === "add" ? panel.seq : 0) + 1 }
        : { mode: "edit", stepId: id },
    );
  };

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/editor"
            aria-label="一覧に戻る"
            title="一覧に戻る"
            className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full border border-black/15 text-zinc-500 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
          <h1 className="truncate text-lg font-semibold">{name}</h1>
        </div>
        <span
          role="status"
          className={`shrink-0 text-xs ${status === "error" ? "text-amber-600 dark:text-amber-400" : "text-zinc-500"}`}
        >
          {SAVE_LABEL[status]}
        </span>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <ActorEditDialog model={model} onSave={commit} />
        <button type="button" className={btn} disabled={!drawable} onClick={openAdd}>
          ＋ ステップを追加
        </button>
        <span className="mx-1 h-6 w-px bg-black/10 dark:bg-white/15" aria-hidden />
        <button type="button" className={btn} disabled={history.past.length === 0} onClick={undo} title="元に戻す（⌘Z）">
          ↶ 元に戻す
        </button>
        <button
          type="button"
          className={btn}
          disabled={history.future.length === 0}
          onClick={redo}
          title="やり直し（⇧⌘Z）"
        >
          ↷ やり直し
        </button>
        <span className="flex-1" />
        {drawable && (
          <div className="flex items-center gap-1">
            {hasAssignees && (
              <label className="mr-2 flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input type="checkbox" checked={showAssignees} onChange={(e) => setShowAssignees(e.target.checked)} />
                担当者を表示
              </label>
            )}
            {/* 拡大縮小は図の上で ⌘ + スクロール。ここは今の倍率の表示と、幅に合わせ直すボタン */}
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs tabular-nums text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
              title="⌘ + スクロールで拡大縮小。クリックで幅に合わせる"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
          </div>
        )}
      </div>

      {/* 中段（可変）: 図（単独スクロール）と、右のパネル（狭い画面では下） */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative flex min-h-[20rem] min-w-0 flex-1 flex-col p-4 lg:min-h-0">
          <RetractNotice model={model} onCommit={commit} />
          <div className="min-h-0 flex-1">
            {drawable ? (
              <MermaidDiagram
                code={displayCode}
                onSvg={(svg, forCode) => setRendered({ svg, code: forCode })}
                onContainerRef={containerRef}
                onPickStep={pickStep}
                onMoveStep={moveStep}
                selectedStep={selectedIndex + 1}
                // 1 = 幅に合わせる（小さい図は拡大しない）。それ以外は幅に対する倍率
                zoom={zoom === 1 ? undefined : zoom}
              />
            ) : (
              <p className="rounded-md border border-dashed border-black/15 p-4 text-sm text-zinc-500 dark:border-white/20">
                まだ図がありません。まず左上の丸いボタン（登場人物を登録）から、業務に関わる人・部署・システムを並べてください。
                そのあと「＋ ステップを追加」で、誰が誰に何をするかを順に書いていきます。
              </p>
            )}
          </div>
          {drawable && steps.length === 0 && (
            <p className="mt-2 shrink-0 text-sm text-zinc-500">
              「＋ ステップを追加」で、最初のステップを書いてください。
            </p>
          )}
        </div>

        {panel?.mode === "edit" && editingIndex >= 0 && (
          <StepPanel model={model} stepId={panel.stepId} onClose={() => setPanel(null)} onCommit={commit}>
            <BranchSection model={model} stepId={panel.stepId} onCommit={commit} />
          </StepPanel>
        )}
        {panel?.mode === "add" && drawable && (
          <StepAddPanel
            // 開き直す・続けて追加するたびに、フォームを初期値から書き直す
            key={panel.seq}
            model={model}
            afterStepId={afterIndex >= 0 ? panel.afterStepId : null}
            initialFrom={panel.initialFrom}
            onAdd={addStep}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/10 px-4 py-2 dark:border-white/15">
        <RetractedSteps model={model} onCommit={commit} />
        <ExportButtons model={model} mermaidCode={code} svg={svgForExport} empty={!drawable} />
      </div>
    </div>
  );
}
