"use client";

import { useState } from "react";
import {
  addArmOps,
  armConditionPrefix,
  BRANCH_KINDS,
  branchKindLabel,
  conditionPrefix,
  groupArms,
  joinBranchOps,
  leaveBranchOps,
  removeGroupOps,
  setGroupKindOps,
  wrapStepOps,
} from "@/lib/model/branch";
import type { Branch, FlowModel, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * ステップの編集パネルに出す「分岐」の欄（/editor 専用）。
 * - 枠の外のステップ: 新しい枠で囲む／ある場合に入れる／場合分けに「そうでなければ」を足して入れる
 * - 枠の中のステップ: 条件・種類を直す／枠から出す／枠ごとやめる
 */
export function BranchSection({
  model,
  stepId,
  onCommit,
}: {
  model: FlowModel;
  stepId: string;
  onCommit: (ops: ModelOp[]) => void;
}) {
  const step = model.steps.find((s) => s.id === stepId);
  const branch = step?.branchId ? model.branches.find((b) => b.id === step.branchId) : undefined;
  if (!step) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/15">
      <span className="text-xs text-zinc-500">分岐（枠）</span>
      {branch ? (
        <InBranch key={branch.id} model={model} stepId={stepId} branch={branch} onCommit={onCommit} />
      ) : (
        <OutOfBranch key={stepId} model={model} stepId={stepId} onCommit={onCommit} />
      )}
    </div>
  );
}

const btn =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const field = "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
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

function InBranch({
  model,
  stepId,
  branch,
  onCommit,
}: {
  model: FlowModel;
  stepId: string;
  branch: Branch;
  onCommit: (ops: ModelOp[]) => void;
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

  return (
    <>
      <p className="text-xs">
        {branchKindLabel(branch.kind)}
        {arms.length > 1 && `（${arms.length} 通りのうち ${arms.findIndex((b) => b.id === branch.id) + 1} つ目）`}
        の中にあります
      </p>
      <label className="flex flex-col gap-1">
        条件
        <input
          className={field}
          value={condition}
          onChange={(e) => setDraft({ for: key, text: e.target.value })}
          onBlur={commitCondition}
          onKeyDown={enter(commitCondition)}
        />
      </label>
      {arms.length === 1 && (
        <label className="flex flex-col gap-1">
          種類
          <select
            className={field}
            value={branch.kind}
            onChange={(e) => onCommit(setGroupKindOps(model, branch.groupId, e.target.value as Branch["kind"]))}
          >
            {BRANCH_KINDS.map((k) => (
              <option key={k.kind} value={k.kind} title={k.hint}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {branch.kind === "alt" && arms.length === 1 && (
        <p className="text-xs text-zinc-500">
          「そうでなければ」のステップは、枠の外のステップを選んで「場合分けに別の場合を足して入れる」で入れます。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} onClick={() => onCommit(leaveBranchOps(model, stepId))}>
          枠から出す
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className={`${btn} border-red-600 text-red-700 dark:border-red-400 dark:text-red-300`}
              onClick={() => onCommit(removeGroupOps(model, branch.groupId))}
            >
              枠をやめる
            </button>
            <button type="button" className={btn} onClick={() => setConfirming(false)}>
              やめない
            </button>
          </>
        ) : (
          <button
            type="button"
            className={btn}
            title="枠を消します（中のステップは残ります）"
            onClick={() => setConfirming(true)}
          >
            枠ごとやめる
          </button>
        )}
      </div>
    </>
  );
}

type Mode = "wrap" | "join" | "arm" | null;

function OutOfBranch({
  model,
  stepId,
  onCommit,
}: {
  model: FlowModel;
  stepId: string;
  onCommit: (ops: ModelOp[]) => void;
}) {
  const [mode, setMode] = useState<Mode>(null);
  const [kind, setKind] = useState<Branch["kind"]>("alt");
  const [condition, setCondition] = useState("");
  // 図に見えている枠だけを候補にする（中身が全部消えた枠は出さない）
  const shown = new Set(visibleSteps(model).map((s) => s.branchId));
  const branches = model.branches.filter((b) => shown.has(b.id));
  const groups = [...new Set(branches.map((b) => b.groupId))];
  const altGroups = groups.filter((g) => groupArms(model, g)[0]?.kind === "alt");
  const describe = (b: Branch) => `${branchKindLabel(b.kind)} [${b.condition}]`;
  // 候補の既定は、すぐ上のステップの枠（「そうでなければ」は、直前の場合分けに足すことが多い）
  const steps = visibleSteps(model);
  const prev = steps[steps.findIndex((s) => s.id === stepId) - 1];
  const prevBranch = prev?.branchId ? model.branches.find((b) => b.id === prev.branchId) : undefined;
  const [target, setTarget] = useState<string>(prevBranch?.id ?? branches[0]?.id ?? "");
  const [armGroup, setArmGroup] = useState<string>(
    prevBranch && altGroups.includes(prevBranch.groupId) ? prevBranch.groupId : (altGroups[0] ?? ""),
  );
  // 条件欄に最初から入れておく書き出し（直前のステップ名）。書き出しだけでは条件にならない
  const [prefix, setPrefix] = useState("");
  const ready = condition.trim() !== "" && condition.trim() !== prefix.trim();
  const start = (next: Mode, text: string) => {
    setMode(next);
    setPrefix(text);
    setCondition(text);
  };

  const submitWrap = () => ready && onCommit(wrapStepOps(model, stepId, kind, condition));
  const submitArm = () => ready && onCommit(addArmOps(model, stepId, armGroup, condition));

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} aria-pressed={mode === "wrap"} onClick={() => start("wrap", prev ? conditionPrefix(prev.label) : "")}>
          枠で囲む
        </button>
        {branches.length > 0 && (
          <button type="button" className={btn} aria-pressed={mode === "join"} onClick={() => setMode("join")}>
            枠に入れる
          </button>
        )}
        {altGroups.length > 0 && (
          <button type="button" className={btn} aria-pressed={mode === "arm"} onClick={() => start("arm", armConditionPrefix(model, armGroup))}>
            別の場合を足して入れる
          </button>
        )}
      </div>

      {mode === "wrap" && (
        <>
          <label className="flex flex-col gap-1">
            種類
            <select className={field} value={kind} onChange={(e) => setKind(e.target.value as Branch["kind"])}>
              {BRANCH_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}（{k.hint}）
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            条件
            <input
              autoFocus
              onFocus={caretToEnd}
              className={field}
              value={condition}
              placeholder={kind === "loop" ? "例: 不備がなくなるまで" : "例: 不備あり"}
              onChange={(e) => setCondition(e.target.value)}
              onKeyDown={enter(submitWrap)}
            />
          </label>
          <button type="button" className={btn} disabled={!ready} onClick={submitWrap}>
            このステップを枠で囲む
          </button>
        </>
      )}

      {mode === "join" && (
        <>
          <label className="flex flex-col gap-1">
            入れる先
            <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {describe(b)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zinc-500">その場合の最後のステップの後ろへ移ります</p>
          <button
            type="button"
            className={btn}
            disabled={target === ""}
            onClick={() => onCommit(joinBranchOps(model, stepId, target))}
          >
            枠に入れる
          </button>
        </>
      )}

      {mode === "arm" && (
        <>
          {altGroups.length > 1 && (
            <label className="flex flex-col gap-1">
              どの場合分けに
              <select
                className={field}
                value={armGroup}
                onChange={(e) => {
                  setArmGroup(e.target.value);
                  start("arm", armConditionPrefix(model, e.target.value));
                }}
              >
                {altGroups.map((g) => (
                  <option key={g} value={g}>
                    {groupArms(model, g)
                      .map((b) => `[${b.condition}]`)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            この場合の条件
            <input
              autoFocus
              onFocus={caretToEnd}
              className={field}
              value={condition}
              placeholder="例: 問題なし"
              onChange={(e) => setCondition(e.target.value)}
              onKeyDown={enter(submitArm)}
            />
          </label>
          <button type="button" className={btn} disabled={!ready || armGroup === ""} onClick={submitArm}>
            別の場合として入れる
          </button>
        </>
      )}
    </>
  );
}
