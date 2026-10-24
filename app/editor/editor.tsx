"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActorEditDialog } from "@/app/components/actor-edit-dialog";
import { ExportButtons } from "@/app/components/export-buttons";
import { MermaidDiagram, renderMermaidSvg } from "@/app/components/mermaid-diagram";
import { RetractedSteps, RetractNotice } from "@/app/components/retracted-steps";
import { StepPanel } from "@/app/components/step-panel";
import { SummaryButton } from "@/app/components/summary-dialog";
import { addStepOp, type StepInput } from "@/lib/model/add-step";
import { moveStepOps } from "@/lib/model/move";
import { noteMarks } from "@/lib/model/notes";
import { applyOps } from "@/lib/model/reducer";
import { addFrameOps, enterBranchOps } from "@/lib/model/branch";
import type { Branch, FlowModel, ModelOp } from "@/lib/model/types";
import { stripPlaceholders } from "@/lib/render/export";
import { dutiesReadiness } from "@/lib/summary/readiness";
import {
  armOfTarget,
  collapsedFrames,
  drawnFrames,
  emptyArms,
  frameIds,
  hasDiagram,
  toMermaid,
  visibleSteps,
  type ArmTarget,
} from "@/lib/render/mermaid";
import { BranchAddPanel } from "./branch-add-panel";
import { BranchSection } from "./branch-section";
import { FlowPlayer } from "./flow-player";
import { FramePanel } from "./frame-panel";
import { ReviewPanel } from "./review-panel";
import { StepAddPanel } from "./step-add-panel";
import { useAiReview } from "./use-ai-review";
import { useCollapsedFrames } from "./use-collapsed-frames";
import { useDiagramAutosave } from "./use-diagram-autosave";
import { useWheelZoom } from "./use-wheel-zoom";

/** 元に戻せる回数 */
const MAX_HISTORY = 100;

type History = { past: FlowModel[]; present: FlowModel; future: FlowModel[] };

/** 右側のパネル。ステップの編集か、ステップの追加 */
type Panel =
  | { mode: "edit"; stepId: string }
  /** into: その場合（空の枠の「＋ ここにステップを追加」など）の最後に入れる */
  | { mode: "add"; afterStepId: string | null; into?: string; initialFrom?: string; seq: number }
  | { mode: "branch"; afterStepId: string | null; seq: number }
  /** 図の点検。focus は、指摘から示している図の手順（1 始まり。0 なら無し） */
  | { mode: "review"; focus: number }
  /** 枠（groupId）の付箋。図の枠の見出しの札を右クリックする・札の横の付箋の印を押すと開く */
  | { mode: "frame"; groupId: string }
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
  const { zoom, setZoom, containerRef, hand } = useWheelZoom();
  const [showAssignees, setShowAssignees] = useState(false);
  const [rendered, setRendered] = useState<{ svg: string; code: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const aiReview = useAiReview();

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
  const drawable = hasDiagram(model);
  const steps = visibleSteps(model);
  const readiness = useMemo(() => dutiesReadiness(model), [model]);

  // 消えた（削除・元に戻した）ステップは選んでいないことにする
  const editingIndex = panel?.mode === "edit" ? steps.findIndex((s) => s.id === panel.stepId) : -1;
  const afterIndex =
    (panel?.mode === "add" || panel?.mode === "branch") && panel.afterStepId
      ? steps.findIndex((s) => s.id === panel.afterStepId)
      : -1;
  const intoArm = panel?.mode === "add" && panel.into ? model.branches.find((b) => b.id === panel.into) : undefined;
  const selectedIndex = editingIndex >= 0 ? editingIndex : afterIndex;

  // ── 枠（alt / opt / loop）を畳む。画面の見え方だけで、図のデータは変えない ──
  const [collapsed, setCollapsed] = useCollapsedFrames(slug);
  const frames = frameIds(model);
  // 選んでいる・点検で示している・中に足そうとしているステップの枠は、畳んでいても開いて見せる
  const shownGroups = new Set(
    [
      steps[selectedIndex]?.branchId,
      panel?.mode === "review" ? steps[panel.focus - 1]?.branchId : undefined,
      intoArm?.id,
    ].flatMap((id) => model.branches.find((b) => b.id === id)?.groupId ?? []),
  );
  const folded = [...collapsed].filter((g) => frames.includes(g) && !shownGroups.has(g)).sort();
  const foldedKey = folded.join(",");
  const foldedSet = useMemo(() => new Set(foldedKey ? foldedKey.split(",") : []), [foldedKey]);
  // 枠の見出しを押すと畳む。中心の人の手順だけを残して畳んでいる枠なら、開く
  const collapseFrame = (frame: number) => {
    const groupId = drawnFrames(model, foldedSet)[frame]?.[0].groupId;
    if (!groupId) return;
    setCollapsed(
      foldedSet.has(groupId) ? new Set([...collapsed].filter((g) => g !== groupId)) : new Set([...collapsed, groupId]),
    );
  };
  const openFrameNotes = (at: { drawn: number } | { folded: number }) => {
    const groupId =
      "drawn" in at ? drawnFrames(model, foldedSet)[at.drawn]?.[0].groupId : collapsedFrames(model, foldedSet)[at.folded];
    if (groupId) setPanel({ mode: "frame", groupId });
  };
  const expandFrame = (k: number) => {
    const groupId = collapsedFrames(model, foldedSet)[k];
    if (groupId) setCollapsed(new Set([...collapsed].filter((g) => g !== groupId)));
  };

  // 手直しのパネルで書きかけの名前・渡すもの・担当者。確定する前から画面の図に映す（モデルには入れない）
  const [preview, setPreview] = useState<ModelOp[] | null>(null);
  const shownModel = useMemo(() => (preview ? applyOps(model, preview, model.updatedAt) : model), [model, preview]);
  // 付箋（手順・枠・登場人物に結び付いた論点）の印。図のそれぞれの横に出す
  const notes = useMemo(() => noteMarks(shownModel, foldedSet), [shownModel, foldedSet]);
  // 画面の図には、空の場合に「＋ ここにステップを追加」を描く（書き出す .svg からは外す）
  const displayCode = useMemo(
    () => toMermaid(shownModel, { assignees: showAssignees, placeholders: true, collapsed: foldedSet }),
    [shownModel, showAssignees, foldedSet],
  );
  // .svg は畳んだ枠も開いて、全部の手順で書き出す。畳んでいなければ画面の図をそのまま使う
  const exportCode = useMemo(
    () => toMermaid(model, { assignees: showAssignees, placeholders: true }),
    [model, showAssignees],
  );
  const [expanded, setExpanded] = useState<{ svg: string; code: string } | null>(null);
  useEffect(() => {
    if (exportCode === displayCode) return;
    let cancelled = false;
    // 編集のたびに描き直さないよう、画面の図（mermaid-diagram.tsx）と同じくらい間を置く
    const timer = setTimeout(() => {
      renderMermaidSvg(exportCode)
        .then((svg) => {
          if (!cancelled && svg) setExpanded({ svg: stripPlaceholders(svg), code: exportCode });
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [exportCode, displayCode]);
  const svgForExport =
    exportCode === displayCode
      ? rendered && rendered.code === displayCode
        ? rendered.svg
        : null
      : expanded && expanded.code === exportCode
        ? expanded.svg
        : null;

  const pickStep = (n: number) => {
    const id = steps[n - 1]?.id;
    if (!id) return;
    // 追加フォームを開いているときは、入れる位置を選び直す（場合の中に入れる指定は外す）
    setPanel((p) =>
      p?.mode === "add" || p?.mode === "branch"
        ? { ...p, afterStepId: id, ...(p.mode === "add" ? { into: undefined } : {}) }
        : { mode: "edit", stepId: id },
    );
  };
  /** inside = 落とした点のある枠（図の上から何番目か）と場合（枠の中で何番目か）。null = どの枠の外 */
  const moveStep = (index: number, insertAt: number, inside?: { frame: number; arm: number } | null) => {
    const target =
      inside === undefined ? undefined : inside === null ? null : drawnFrames(model, foldedSet)[inside.frame]?.[inside.arm];
    const ops = moveStepOps(steps, index, insertAt, target);
    if (ops.length === 0) return;
    commit(ops);
    setPanel({ mode: "edit", stepId: steps[index].id });
  };
  /** 図の上で、ステップを場合の目印（空の場合の注記・枠の条件）へ落としたら、その場合の中へ入れる */
  const dropToArm = (index: number, target: ArmTarget) => {
    const arm = armOfTarget(model, target, foldedSet);
    const step = steps[index];
    if (!arm || !step) return;
    const ops = enterBranchOps(model, step.id, arm.id, "frame");
    if (ops.length === 0) return;
    commit(ops);
    setPanel({ mode: "edit", stepId: step.id });
  };
  const nextSeq = (panel?.mode === "add" || panel?.mode === "branch" ? panel.seq : 0) + 1;
  // いま選んでいるステップ（編集中、または追加する位置）。その後ろに足す
  const selectedId = selectedIndex >= 0 ? steps[selectedIndex].id : null;
  const openAdd = () => setPanel({ mode: "add", afterStepId: selectedId, seq: nextSeq });
  const openBranch = () => setPanel({ mode: "branch", afterStepId: selectedId, seq: nextSeq });
  /** 場合（branchId）の最後にステップを足すフォームを開く */
  const openAddInto = (branchId: string) => setPanel({ mode: "add", afterStepId: null, into: branchId, seq: nextSeq });
  const pickPlaceholder = (k: number) => {
    const arm = emptyArms(model, foldedSet)[k];
    if (arm) openAddInto(arm.id);
  };
  const addStep = (input: StepInput, again: boolean) => {
    const afterStepId = panel?.mode === "add" ? panel.afterStepId : null;
    const op = addStepOp(model, input, afterStepId, intoArm?.id);
    if (op.op !== "step.add") return;
    commit([op]);
    const id = op.step.id;
    // 続けて追加するときも、同じ場合の中に入れ続ける
    setPanel(
      again
        ? { mode: "add", afterStepId: id, into: intoArm?.id, initialFrom: input.to, seq: nextSeq }
        : { mode: "edit", stepId: id },
    );
  };
  const createFrame = (kind: Branch["kind"], conditions: string[]) => {
    const { ops, armIds } = addFrameOps(model, kind, conditions, panel?.mode === "branch" ? panel.afterStepId : null);
    if (ops.length === 0) return;
    commit(ops);
    // 作った枠の最初の場合に、そのままステップを足せるようにする
    setPanel({ mode: "add", afterStepId: null, into: armIds[0], seq: nextSeq });
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
        <button
          type="button"
          className={btn}
          disabled={!drawable}
          title="条件によって変わる作業（もし〜なら）や、くり返す作業の枠を先に作ります"
          onClick={openBranch}
        >
          ＋ 分岐を追加
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
        <span className="mx-1 h-6 w-px bg-black/10 dark:bg-white/15" aria-hidden />
        <button
          type="button"
          className={btn}
          disabled={steps.length === 0}
          title="起点から終点まで、図の上で手順を順に追いながら、字幕で流れを確認します"
          onClick={() => setPreviewing(true)}
        >
          ▶ フローの再生
        </button>
        <button
          type="button"
          className={`${btn} ${panel?.mode === "review" ? "bg-black/5 dark:bg-white/10" : ""}`}
          disabled={!drawable}
          aria-pressed={panel?.mode === "review"}
          title="図の抜けや書き方の気になる点を、決まりごとと AI で点検します"
          onClick={() => setPanel(panel?.mode === "review" ? null : { mode: "review", focus: 0 })}
        >
          ✓ フローを点検
        </button>
        <span className="flex-1" />
        {drawable && (
          <div className="flex items-center gap-1">
            {frames.length > 0 && (
              <button
                type="button"
                className="mr-2 rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
                title="枠（alt / opt / loop）は、見出しの札を押すと 1 つずつ畳めます。畳んだ枠は押すと開きます"
                onClick={() => setCollapsed(folded.length > 0 ? new Set() : new Set(frames))}
              >
                {folded.length > 0 ? "▾ 枠をすべて開く" : "▸ 枠をすべて畳む"}
              </button>
            )}
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
              title="⌘ + スクロールで拡大縮小、Space + ドラッグで移動。クリックで幅に合わせる"
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
          <div
            className={`min-h-0 flex-1 ${
              hand === "grabbing" ? "select-none [&_*]:!cursor-grabbing" : hand === "grab" ? "[&_*]:!cursor-grab" : ""
            }`}
          >
            {drawable ? (
              <MermaidDiagram
                code={displayCode}
                onSvg={(svg, forCode) => setRendered({ svg: stripPlaceholders(svg), code: forCode })}
                onContainerRef={containerRef}
                onPickStep={pickStep}
                onPickPlaceholder={pickPlaceholder}
                onMoveStep={moveStep}
                onDropToArm={dropToArm}
                onCollapseFrame={collapseFrame}
                onExpandFrame={expandFrame}
                onFrameNotes={openFrameNotes}
                selectedStep={selectedIndex + 1}
                notes={notes}
                highlightStep={panel?.mode === "review" ? panel.focus : 0}
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
          <StepPanel
            model={model}
            stepId={panel.stepId}
            onClose={() => setPanel(null)}
            onCommit={commit}
            onPreview={setPreview}
          >
            <BranchSection model={model} stepId={panel.stepId} onCommit={commit} onAddInto={openAddInto} />
          </StepPanel>
        )}
        {panel?.mode === "add" && drawable && (
          <StepAddPanel
            // 開き直す・続けて追加するたびに、フォームを初期値から書き直す
            key={panel.seq}
            model={model}
            afterStepId={afterIndex >= 0 ? panel.afterStepId : null}
            into={intoArm}
            initialFrom={panel.initialFrom}
            onAdd={addStep}
            onRemoveInto={intoArm ? () => {
              commit([{ op: "branch.remove", id: intoArm.id }]);
              setPanel(null);
            } : undefined}
            onClose={() => setPanel(null)}
          />
        )}
        {panel?.mode === "review" && drawable && (
          <ReviewPanel
            model={model}
            name={name}
            ai={aiReview.state}
            onRunAi={(already) => aiReview.run(model, name, already)}
            onCommit={commit}
            onPreview={setPreview}
            focusStep={panel.focus}
            onFocusStep={(n) => setPanel({ mode: "review", focus: n })}
            onClose={() => setPanel(null)}
          />
        )}
        {panel?.mode === "frame" && drawable && (
          <FramePanel model={model} groupId={panel.groupId} onCommit={commit} onClose={() => setPanel(null)} />
        )}
        {panel?.mode === "branch" && drawable && (
          <BranchAddPanel
            key={panel.seq}
            model={model}
            afterStepId={afterIndex >= 0 ? panel.afterStepId : null}
            onCreate={createFrame}
            onClose={() => setPanel(null)}
          />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/10 px-4 py-2 dark:border-white/15">
        <RetractedSteps model={model} onCommit={commit} />
        <SummaryButton model={model} empty={!drawable} readiness={readiness} />
        <ExportButtons model={model} mermaidCode={code} svg={svgForExport} empty={!drawable} />
      </div>
      {previewing && <FlowPlayer name={name} model={model} onClose={() => setPreviewing(false)} />}
    </div>
  );
}
