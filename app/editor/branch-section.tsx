"use client";

import { useState } from "react";
import { NotesSection } from "@/app/components/notes-section";
import { PanelSection } from "@/app/components/step-panel";
import {
  addEmptyArmOps,
  armConditionPrefix,
  BRANCH_KINDS,
  branchKindLabel,
  enterBranchOps,
  groupArms,
  leaveBranchOps,
  moveArmOps,
  removeGroupOps,
  setGroupKindOps,
} from "@/lib/model/branch";
import type { Branch, FlowModel, ModelOp } from "@/lib/model/types";
import { drawnFrames, visibleSteps } from "@/lib/render/mermaid";

/**
 * ステップの編集パネルに出す「分岐」の欄（/editor 専用）。初めて使う人にも分かるように、
 * 図の言葉（alt / opt / loop、枠、場合）ではなく「もし〜なら」「〜のときだけ」「〜の間くり返す」で書く。
 * 分岐は先に枠を作り（ツールバーの「＋ 分岐を追加」）、中にステップを足す。ここでは作った枠を直す。
 * - 枠の中のステップ: 枠の中身を小さな見取り図で見せ、そこで条件・場合の順番を直し、場合ごとにステップを足す
 * - 枠の外のステップ: 分岐の作り方を案内し、作ってある枠があれば、そこへ入れられるようにする
 */
export function BranchSection({
  model,
  stepId,
  onCommit,
  onAddInto,
}: {
  model: FlowModel;
  stepId: string;
  onCommit: (ops: ModelOp[]) => void;
  /** 場合（branchId）の最後にステップを足すフォームを開く */
  onAddInto: (branchId: string) => void;
}) {
  const step = model.steps.find((s) => s.id === stepId);
  const branch = step?.branchId ? model.branches.find((b) => b.id === step.branchId) : undefined;
  if (!step) return null;
  return (
    <PanelSection title="分岐（条件・繰り返し）">
      {branch ? (
        <InBranch
          key={branch.id}
          model={model}
          stepId={stepId}
          branch={branch}
          onCommit={onCommit}
          onAddInto={onAddInto}
        />
      ) : (
        <>
          <p className="text-xs text-zinc-500">
            条件によって変わる作業や、くり返す作業は、上の「＋ 分岐を追加」で先に枠を作り、その中にステップを足します。
          </p>
          <EnterFrame
            label="作ってある枠に入れる"
            model={model}
            stepId={stepId}
            exceptGroup={null}
            onCommit={onCommit}
          />
        </>
      )}
    </PanelSection>
  );
}

/** 種類ごとの言い方。条件を「もし〜なら」の形で読めるようにする */
export const KIND_TEXT: Record<Branch["kind"], { title: string; example: string; before: string; after: string }> = {
  alt: { title: "もし〜なら（場合分け）", example: "例: 不備があれば差し戻す", before: "もし", after: "なら" },
  opt: { title: "〜のときだけやる", example: "例: 金額が大きいときだけ承認を取る", before: "", after: "のときだけ" },
  loop: { title: "〜の間くり返す", example: "例: 不備がなくなるまで直す", before: "", after: "の間くり返す" },
};

const btn =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const iconBtn =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-black/15 bg-background text-xs hover:bg-black/5 disabled:opacity-30 disabled:hover:bg-background dark:border-white/20 dark:hover:bg-white/10";
const field = "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
const caption = "text-xs text-zinc-500";
/** 書き出しを入れた条件欄にフォーカスしたら、続きを書けるようにカーソルを末尾へ */
const caretToEnd = (e: React.FocusEvent<HTMLInputElement>) => {
  const n = e.currentTarget.value.length;
  e.currentTarget.setSelectionRange(n, n);
};
const enter = (fn: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
    e.preventDefault();
    fn();
  }
};

/** 場合を「もし［〜］なら」の形で */
const armText = (arm: Branch, i: number) =>
  `${i > 0 && arm.kind === "alt" ? "そうでなく" : KIND_TEXT[arm.kind].before}［${arm.condition}］${KIND_TEXT[arm.kind].after}`;

/**
 * ステップを、作ってある枠のどれかの場合へ入れる選択欄。枠が無ければ出さない。
 * exceptGroup の枠（いま入っている枠。場合の移し替えは見取り図のボタンで行う）は並べない
 */
function EnterFrame({
  label,
  model,
  stepId,
  exceptGroup,
  onCommit,
}: {
  label: string;
  model: FlowModel;
  stepId: string;
  exceptGroup: string | null;
  onCommit: (ops: ModelOp[]) => void;
}) {
  const frames = drawnFrames(model)
    .map((arms, k) => ({ arms, k }))
    .filter(({ arms }) => arms[0]?.groupId !== exceptGroup);
  if (frames.length === 0) return null;
  return (
    <label className="flex flex-col gap-1">
      <span className={caption}>{label}</span>
      <select
        className={field}
        value=""
        onChange={(e) => e.target.value && onCommit(enterBranchOps(model, stepId, e.target.value))}
      >
        <option value="">枠と場合を選ぶ…</option>
        {frames.map(({ arms, k }) => (
          <optgroup key={arms[0].groupId} label={`枠 ${k + 1}（${branchKindLabel(arms[0].kind)}）`}>
            {arms.map((arm, i) => (
              <option key={arm.id} value={arm.id}>
                {armText(arm, i)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** 図の番号つきで、その場合に入っているステップ */
function armSteps(model: FlowModel, branchId: string) {
  return visibleSteps(model)
    .map((s, i) => ({ step: s, n: i + 1 }))
    .filter((x) => x.step.branchId === branchId);
}

function InBranch({
  model,
  stepId,
  branch,
  onCommit,
  onAddInto,
}: {
  model: FlowModel;
  stepId: string;
  branch: Branch;
  onCommit: (ops: ModelOp[]) => void;
  onAddInto: (branchId: string) => void;
}) {
  const arms = groupArms(model, branch.groupId);
  const [draft, setDraft] = useState<{ for: string; text: string } | null>(null);
  const key = `${branch.id}:${branch.condition}`;
  const condition = draft?.for === key ? draft.text : branch.condition;
  const commitCondition = () => {
    setDraft(null);
    const next = condition.replace(/\s+/g, " ").trim();
    if (next !== "" && next !== branch.condition) {
      onCommit([{ op: "branch.update", id: branch.id, patch: { condition: next } }]);
    }
  };
  const [confirming, setConfirming] = useState(false);
  // 「＋ 場合を足す」の書きかけ（null なら閉じている）
  const [newArm, setNewArm] = useState<string | null>(null);
  const prefix = armConditionPrefix(model, branch.groupId);
  const submitArm = () => {
    if (newArm === null || newArm.trim() === "" || newArm.trim() === prefix.trim()) return;
    onCommit(addEmptyArmOps(model, branch.groupId, newArm));
    setNewArm(null);
  };
  const text = KIND_TEXT[branch.kind];
  /** 条件の前に置く言葉。場合分けの 2 つ目からは「そうでなく」 */
  const lead = (i: number) => (i > 0 && branch.kind === "alt" ? "そうでなく" : text.before);

  return (
    <>
      {/* 枠の見取り図。いまのステップが入っている場合を強調し、そこで条件と順番を直す */}
      <div className="rounded-md border border-dashed border-violet-400/70 dark:border-violet-400/50">
        <div className="flex items-center gap-2 border-b border-dashed border-violet-400/70 px-2.5 py-1.5 dark:border-violet-400/50">
          <span className="shrink-0 whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">
            {branchKindLabel(branch.kind)}
          </span>
          <span className={caption}>{BRANCH_KINDS.find((k) => k.kind === branch.kind)?.hint}</span>
        </div>
        <ol className="flex flex-col">
          {arms.map((arm, i) => {
            const current = arm.id === branch.id;
            const steps = armSteps(model, arm.id);
            return (
              <li
                key={arm.id}
                className={`flex flex-col gap-1.5 px-2.5 py-2 ${i > 0 ? "border-t border-dashed border-violet-400/70 dark:border-violet-400/50" : ""} ${
                  current ? "bg-sky-50 dark:bg-sky-500/10" : ""
                }`}
              >
                {current ? (
                  <div className="flex items-center gap-1.5">
                    {lead(i) && <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-300">{lead(i)}</span>}
                    <input
                      aria-label="この場合の条件"
                      className={`${field} min-w-0 flex-1 bg-background px-2 py-1`}
                      value={condition}
                      onChange={(e) => setDraft({ for: key, text: e.target.value })}
                      onBlur={commitCondition}
                      onKeyDown={enter(commitCondition)}
                    />
                    <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-300">{text.after}</span>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 dark:text-zinc-300">
                    {lead(i)}［{arm.condition}］{text.after}
                  </p>
                )}
                <div className="flex items-start gap-1.5">
                  <ul className="min-w-0 flex-1 text-xs">
                    {steps.length === 0 && <li className="text-zinc-400">（まだステップがありません）</li>}
                    {steps.map(({ step, n }) => (
                      <li key={step.id} className={step.id === stepId ? "font-medium text-sky-700 dark:text-sky-300" : "text-zinc-600 dark:text-zinc-400"}>
                        {n}. {step.label}
                        {step.id === stepId && "（このステップ）"}
                      </li>
                    ))}
                  </ul>
                  {current && arms.length > 1 && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className={iconBtn}
                        aria-label="この場合を上へ"
                        title="この場合を上へ（中のステップごと入れ替えます）"
                        disabled={i === 0}
                        onClick={() => onCommit(moveArmOps(model, branch.id, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className={iconBtn}
                        aria-label="この場合を下へ"
                        title="この場合を下へ（中のステップごと入れ替えます）"
                        disabled={i === arms.length - 1}
                        onClick={() => onCommit(moveArmOps(model, branch.id, 1))}
                      >
                        ↓
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <button
                    type="button"
                    className="w-fit whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-500/10"
                    onClick={() => onAddInto(arm.id)}
                  >
                    ＋ ステップを追加
                  </button>
                  {!current && (
                    <button
                      type="button"
                      className="w-fit whitespace-nowrap rounded px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-500/10"
                      title="このステップを、この場合の最後へ移します"
                      onClick={() => onCommit(enterBranchOps(model, stepId, arm.id))}
                    >
                      このステップをここへ移す
                    </button>
                  )}
                  {steps.length === 0 && arms.length > 1 && (
                    <button
                      type="button"
                      className="w-fit rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
                      title="中にステップが無いこの場合を消します"
                      onClick={() => onCommit([{ op: "branch.remove", id: arm.id }])}
                    >
                      この場合を消す
                    </button>
                  )}
                </div>
              </li>
            );
          })}
          {branch.kind === "alt" && (
            <li className="flex flex-col gap-1.5 border-t border-dashed border-violet-400/70 px-2.5 py-1.5 dark:border-violet-400/50">
              {newArm === null ? (
                <button
                  type="button"
                  className="w-fit rounded px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-500/10"
                  onClick={() => setNewArm(prefix)}
                >
                  ＋ 場合を足す（そうでなければ）
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs">そうでなく</span>
                  <input
                    autoFocus
                    aria-label="足す場合の条件"
                    onFocus={caretToEnd}
                    className={`${field} min-w-0 flex-1 bg-background px-2 py-1`}
                    value={newArm}
                    placeholder="問題がない"
                    onChange={(e) => setNewArm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setNewArm(null);
                      } else enter(submitArm)(e);
                    }}
                  />
                  <span className="shrink-0 text-xs">なら</span>
                  <button type="button" className={iconBtn} aria-label="場合を足す" onClick={submitArm}>
                    ✓
                  </button>
                </div>
              )}
            </li>
          )}
        </ol>
      </div>

      {arms.length === 1 && (
        <div className="flex flex-col gap-1">
          <span className={caption}>種類を変える</span>
          <div role="group" aria-label="分岐の種類" className="inline-flex w-fit rounded-md border border-black/15 p-0.5 dark:border-white/20">
            {BRANCH_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                title={k.hint}
                aria-pressed={branch.kind === k.kind}
                className="rounded px-2.5 py-1 text-xs text-zinc-600 aria-pressed:bg-violet-600 aria-pressed:text-white dark:text-zinc-300"
                onClick={() => branch.kind !== k.kind && onCommit(setGroupKindOps(model, branch.groupId, k.kind))}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <NotesSection model={model} target={{ kind: "frame", id: branch.groupId }} onCommit={onCommit} inline />

      <EnterFrame label="ほかの枠へ移す" model={model} stepId={stepId} exceptGroup={branch.groupId} onCommit={onCommit} />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btn}
          title="このステップだけを枠の外に出します（枠とほかのステップはそのまま）"
          onClick={() => onCommit(leaveBranchOps(model, stepId))}
        >
          このステップを枠の外へ
        </button>
        {confirming ? (
          <>
            <button type="button" className={btn} onClick={() => setConfirming(false)}>
              やめる
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              onClick={() => onCommit(removeGroupOps(model, branch.groupId))}
            >
              枠を消す
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
            title="枠を消します（中のステップは消えずに残ります）"
            onClick={() => setConfirming(true)}
          >
            枠を消す
          </button>
        )}
      </div>
      {confirming && <p className={caption}>枠だけを消します。中のステップは消えずに残ります。</p>}
    </>
  );
}
