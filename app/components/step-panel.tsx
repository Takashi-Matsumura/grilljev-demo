"use client";

import { useState } from "react";
import { moveStepOps } from "@/lib/model/move";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * 図の番号をクリックしたときに、図の横（狭い画面では下）に開く、ステップの手直し。
 * 人は言い間違えるので、音声で足したステップを、名前・送り手・受け手・確定/仮・順番・削除で直せるようにする。
 *
 * 図を覆わない（モーダルにしない）。選んだステップは図で強調するので、順番を動かすと強調ごと動くのが見える。
 * 変更はその場で反映する（名前は入力を確定したとき＝Enter かフォーカスを外したとき）。
 */
export function StepPanel({
  model,
  stepId,
  onClose,
  onCommit,
  onFocus,
}: {
  model: FlowModel;
  /** 開いているステップ。図に無ければ何も出さない */
  stepId: string;
  onClose: () => void;
  onCommit: (ops: ModelOp[]) => void;
  /** 渡すと「声で直す」を出す。このステップを、番号を言わずに音声で直す対象にする */
  onFocus?: (stepId: string) => void;
}) {
  const steps = visibleSteps(model);
  const index = steps.findIndex((s) => s.id === stepId);
  const step = index >= 0 ? steps[index] : null;
  // 名前の書きかけ。別のステップに切り替わる・外から名前が変わったら、今の名前から書き直す
  const [draft, setDraft] = useState<{ for: string; label: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  if (!step) return null;

  const label = draft?.for === `${step.id}:${step.label}` ? draft.label : step.label;
  const update = (patch: Extract<ModelOp, { op: "step.update" }>["patch"]) =>
    onCommit([{ op: "step.update", id: step.id, patch }]);
  const commitLabel = () => {
    const next = label.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (next !== "" && next !== step.label) update({ label: next });
  };
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
  const field =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";

  return (
    <aside
      aria-label="ステップの編集"
      className="flex shrink-0 flex-col gap-3 overflow-y-auto border-t border-black/10 p-4 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">
          <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-600 px-1.5 text-xs text-white">
            {index + 1}
          </span>
          ステップの編集
        </h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="-mt-2 text-xs text-zinc-500">
        {nameOf(step.from)} → {nameOf(step.to)}
      </p>

      <label className="flex flex-col gap-1">
        名前
        <input
          className={field}
          value={label}
          onChange={(e) => setDraft({ for: `${step.id}:${step.label}`, label: e.target.value })}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commitLabel();
          }}
        />
      </label>

      {(["from", "to"] as const).map((side) => (
        <label key={side} className="flex flex-col gap-1">
          {side === "from" ? "送り手（誰が）" : "受け手（誰に）"}
          <select className={field} value={step[side]} onChange={(e) => update({ [side]: e.target.value })}>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ))}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={step.status === "confirmed"}
          // 「確定」にしたら実線・確信度 1 にする（要対応の承認と同じ扱い）。外したら仮に戻す
          onChange={(e) =>
            update(e.target.checked ? { status: "confirmed", confidence: 1 } : { status: "provisional" })
          }
        />
        確定にする（外すと仮のステップ＝点線）
      </label>

      <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/15">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">順番</span>
          <button
            type="button"
            className={btn}
            disabled={index === 0}
            onClick={() => onCommit(moveStepOps(steps, index, index - 1))}
          >
            ↑ 前へ
          </button>
          <button
            type="button"
            className={btn}
            disabled={index === steps.length - 1}
            onClick={() => onCommit(moveStepOps(steps, index, index + 2))}
          >
            ↓ 後へ
          </button>
        </div>
        <p className="text-xs text-zinc-500">図の番号やステップ名をドラッグしても並べ替えられます</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/15">
        {onFocus && (
          <button
            type="button"
            className={btn}
            title="このステップを、番号を言わずに声で直せるようにします"
            onClick={() => {
              onFocus(step.id);
              onClose();
            }}
          >
            声で直す
          </button>
        )}
        <span className="flex-1" />
        {confirmingDelete === step.id ? (
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
            <button type="button" className={btn} onClick={() => setConfirmingDelete(null)}>
              やめる
            </button>
          </>
        ) : (
          <button type="button" className={btn} onClick={() => setConfirmingDelete(step.id)}>
            削除
          </button>
        )}
      </div>
    </aside>
  );
}
