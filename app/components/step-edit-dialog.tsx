"use client";

import { useEffect, useRef, useState } from "react";
import type { FlowModel, ModelOp, Step } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

type Draft = { label: string; from: string; to: string; confirmed: boolean };

const draftOf = (s: Step): Draft => ({
  label: s.label,
  from: s.from,
  to: s.to,
  confirmed: s.status === "confirmed",
});

/** 図の n 番目（1 始まり）と、その前後を入れ替える ops。order を交換する */
export function swapOps(steps: Step[], index: number, d: -1 | 1): ModelOp[] {
  const a = steps[index];
  const b = steps[index + d];
  if (!a || !b) return [];
  return [
    { op: "step.update", id: a.id, patch: { order: b.order } },
    { op: "step.update", id: b.id, patch: { order: a.order } },
  ];
}

/**
 * 図の番号をクリックしたときに開く、ステップの手直し。人は言い間違えるので、
 * 音声で足したステップを、名前・送り手・受け手・確定/仮・順番・削除で直せるようにする。
 * 順番の入れ替えと削除はその場で反映し、名前などの書き換えは「保存」で反映する。
 */
export function StepEditDialog({
  model,
  stepId,
  onClose,
  onCommit,
  onFocus,
}: {
  model: FlowModel;
  /** 開いているステップ。null なら閉じる */
  stepId: string | null;
  onClose: () => void;
  onCommit: (ops: ModelOp[]) => void;
  /** 渡すと「声で直す」を出す。このステップを、番号を言わずに音声で直す対象にする */
  onFocus?: (stepId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const steps = visibleSteps(model);
  const index = steps.findIndex((s) => s.id === stepId);
  const step = index >= 0 ? steps[index] : null;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // 開く・別のステップに切り替わるたびに、そのステップの今の内容から書き始める
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (step && openedFor !== step.id) {
    setOpenedFor(step.id);
    setDraft(draftOf(step));
    setConfirmingDelete(false);
  }
  if (!step && openedFor !== null) setOpenedFor(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (step && !el.open) el.showModal();
    if (!step && el.open) el.close();
  }, [step]);

  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);

  const save = () => {
    if (!step || !draft) return;
    const patch: Extract<ModelOp, { op: "step.update" }>["patch"] = {};
    const label = draft.label.replace(/\s+/g, " ").trim();
    if (label !== "" && label !== step.label) patch.label = label;
    if (draft.from !== step.from) patch.from = draft.from;
    if (draft.to !== step.to) patch.to = draft.to;
    // 「確定」にしたら実線・確信度 1 にする（要対応の承認と同じ扱い）。外したら仮に戻す
    if (draft.confirmed !== (step.status === "confirmed")) {
      patch.status = draft.confirmed ? "confirmed" : "provisional";
      if (draft.confirmed) patch.confidence = 1;
    }
    if (Object.keys(patch).length > 0) onCommit([{ op: "step.update", id: step.id, patch }]);
    onClose();
  };

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
  const field =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";

  return (
    <dialog
      ref={ref}
      aria-label="ステップの編集"
      onClose={onClose}
      className="m-auto w-[min(32rem,92vw)] rounded-lg border border-black/15 bg-white p-4 text-inherit backdrop:bg-black/40 dark:border-white/20 dark:bg-zinc-900"
    >
      {step && draft && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">
              <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-800 px-1.5 text-xs text-white dark:bg-zinc-200 dark:text-zinc-900">
                {index + 1}
              </span>
              ステップの編集
            </h2>
            <span className="text-xs text-zinc-500">
              {nameOf(step.from)} → {nameOf(step.to)}
            </span>
          </div>

          <label className="flex flex-col gap-1">
            名前
            <input
              className={field}
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </label>

          <div className="flex gap-2">
            {(["from", "to"] as const).map((side) => (
              <label key={side} className="flex min-w-0 flex-1 flex-col gap-1">
                {side === "from" ? "送り手（誰が）" : "受け手（誰に）"}
                <select
                  className={field}
                  value={draft[side]}
                  onChange={(e) => setDraft({ ...draft, [side]: e.target.value })}
                >
                  {actors.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.confirmed}
              onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })}
            />
            確定にする（外すと仮のステップ＝点線に戻る）
          </label>

          <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/15">
            <span className="text-xs text-zinc-500">順番</span>
            <button
              type="button"
              className={btn}
              disabled={index === 0}
              onClick={() => onCommit(swapOps(steps, index, -1))}
            >
              ↑ 前へ
            </button>
            <button
              type="button"
              className={btn}
              disabled={index === steps.length - 1}
              onClick={() => onCommit(swapOps(steps, index, 1))}
            >
              ↓ 後へ
            </button>
            <span className="flex-1" />
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className={`${btn} border-red-600 text-red-700 dark:border-red-400 dark:text-red-300`}
                  onClick={() => {
                    onCommit([{ op: "step.retract", id: step.id }]);
                    onClose();
                  }}
                >
                  削除する
                </button>
                <button type="button" className={btn} onClick={() => setConfirmingDelete(false)}>
                  やめる
                </button>
              </>
            ) : (
              <button type="button" className={btn} onClick={() => setConfirmingDelete(true)}>
                削除
              </button>
            )}
          </div>

          <div className="flex justify-end gap-2">
            {onFocus && (
              <button
                type="button"
                className={`${btn} mr-auto`}
                title="このステップを、番号を言わずに声で直せるようにします"
                onClick={() => {
                  onFocus(step.id);
                  onClose();
                }}
              >
                声で直す
              </button>
            )}
            <button type="button" className={btn} onClick={onClose}>
              閉じる
            </button>
            <button type="button" className={btn} onClick={save}>
              保存
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
