"use client";

import { useState } from "react";
import { PanelSection } from "@/app/components/step-panel";
import {
  addArmOps,
  armConditionPrefix,
  BRANCH_KINDS,
  branchKindLabel,
  conditionPrefix,
  groupArms,
  joinBranchOps,
  leaveBranchOps,
  moveArmOps,
  removeGroupOps,
  setGroupKindOps,
  wrapStepOps,
} from "@/lib/model/branch";
import type { Branch, FlowModel, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * ステップの編集パネルに出す「分岐」の欄（/editor 専用）。初めて使う人にも分かるように、
 * 図の言葉（alt / opt / loop、枠、場合）ではなく「もし〜なら」「〜のときだけ」「〜の間くり返す」で書く。
 * - 枠の中のステップ: 枠の中身を小さな見取り図で見せ、そこで条件・場合の順番を直す。枠から出す・枠を消す
 * - 枠の外のステップ: やりたいことを文で選ぶ（新しく枠を作る／すぐ上の枠の続きにする／「そうでなければ」にする）
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
    <PanelSection title="分岐（条件・繰り返し）">
      {branch ? (
        <InBranch key={branch.id} model={model} stepId={stepId} branch={branch} onCommit={onCommit} />
      ) : (
        <OutOfBranch key={stepId} model={model} stepId={stepId} onCommit={onCommit} />
      )}
    </PanelSection>
  );
}

/** 種類ごとの言い方。条件を「もし〜なら」の形で読めるようにする */
const KIND_TEXT: Record<Branch["kind"], { title: string; example: string; before: string; after: string }> = {
  alt: { title: "もし〜なら（場合分け）", example: "例: 不備があれば差し戻す", before: "もし", after: "なら" },
  opt: { title: "〜のときだけやる", example: "例: 金額が大きいときだけ承認を取る", before: "", after: "のときだけ" },
  loop: { title: "〜の間くり返す", example: "例: 不備がなくなるまで直す", before: "", after: "の間くり返す" },
};

const btn =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const primaryBtn =
  "rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40 disabled:hover:bg-sky-600";
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
              </li>
            );
          })}
          {branch.kind === "alt" && (
            <li className="border-t border-dashed border-violet-400/70 px-2.5 py-1.5 text-xs text-zinc-500 dark:border-violet-400/50">
              ＋ ほかの場合（そうでなければ）は、枠の外のステップを選んで「『そうでなければ』の場合にする」で足せます
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

type Mode = "wrap" | "join" | "arm" | null;

/** やりたいことを選ぶカード。題と、何が起きるかの一文 */
function Choice({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full flex-col items-start gap-0.5 rounded-md border border-black/15 px-3 py-2 text-left hover:border-sky-500 hover:bg-sky-50 dark:border-white/20 dark:hover:bg-sky-500/10"
      onClick={onClick}
    >
      <span className="text-sm">{title}</span>
      <span className="text-xs text-zinc-500">{detail}</span>
    </button>
  );
}

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
  const steps = visibleSteps(model);
  const shown = new Set(steps.map((s) => s.branchId));
  const branches = model.branches.filter((b) => shown.has(b.id));
  const groups = [...new Set(branches.map((b) => b.groupId))];
  const altGroups = groups.filter((g) => groupArms(model, g)[0]?.kind === "alt");
  const describe = (b: Branch) => {
    const t = KIND_TEXT[b.kind];
    return `${t.before}［${b.condition}］${t.after}`;
  };
  // 候補の既定は、すぐ上のステップの枠（「そうでなければ」は、直前の場合分けに足すことが多い）
  const index = steps.findIndex((s) => s.id === stepId);
  const step = steps[index];
  const prev = steps[index - 1];
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
  const cancel = (
    <button type="button" className={btn} onClick={() => setMode(null)}>
      戻る
    </button>
  );
  const self = step ? `${index + 1}. ${step.label}` : "";

  if (mode === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className={caption}>このステップは、いつも行う作業になっています。条件で変わるなら選んでください。</p>
        <Choice
          title="条件をつける・くり返しにする"
          detail="このステップを新しい枠で囲みます（もし〜なら／〜のときだけ／〜の間くり返す）"
          onClick={() => start("wrap", prev ? conditionPrefix(prev.label) : "")}
        />
        {altGroups.length > 0 && (
          <Choice
            title="「そうでなければ」の場合にする"
            detail="今ある場合分けに、別の条件の場合を足して、このステップをそこに入れます"
            onClick={() => start("arm", armConditionPrefix(model, armGroup))}
          />
        )}
        {branches.length > 0 && (
          <Choice
            title={prevBranch ? "すぐ上のステップと同じ枠に入れる" : "今ある枠に入れる"}
            detail={
              prevBranch
                ? `${describe(prevBranch)} の続きとして、枠の中に入れます`
                : "条件が同じステップの続きとして、枠の中に入れます"
            }
            onClick={() => setMode("join")}
          />
        )}
      </div>
    );
  }

  if (mode === "wrap") {
    const t = KIND_TEXT[kind];
    return (
      <div className="flex flex-col gap-3 rounded-md border border-black/10 p-3 dark:border-white/15">
        <div className="flex flex-col gap-1.5">
          <span className={caption}>どんな条件ですか？</span>
          {BRANCH_KINDS.map((k) => (
            <label key={k.kind} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="branch-kind"
                className="mt-1"
                checked={kind === k.kind}
                onChange={() => setKind(k.kind)}
              />
              <span className="flex flex-col">
                <span className="text-sm">{KIND_TEXT[k.kind].title}</span>
                <span className="text-xs text-zinc-500">{KIND_TEXT[k.kind].example}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <span className={caption}>条件</span>
          <div className="flex items-center gap-1.5">
            {t.before && <span className="shrink-0 text-xs">{t.before}</span>}
            <input
              autoFocus
              aria-label="条件"
              onFocus={caretToEnd}
              className={`${field} min-w-0 flex-1`}
              value={condition}
              placeholder={kind === "loop" ? "不備がなくなるまで" : "不備がある"}
              onChange={(e) => setCondition(e.target.value)}
              onKeyDown={enter(submitWrap)}
            />
            <span className="shrink-0 text-xs">{t.after}</span>
          </div>
          <p className={caption}>→ {self}</p>
        </div>
        <div className="flex justify-end gap-2">
          {cancel}
          <button type="button" className={primaryBtn} disabled={!ready} onClick={submitWrap}>
            枠を作る
          </button>
        </div>
      </div>
    );
  }

  if (mode === "join") {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-black/10 p-3 dark:border-white/15">
        <label className="flex flex-col gap-1">
          <span className={caption}>どの条件の中に入れますか？</span>
          <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {describe(b)}
              </option>
            ))}
          </select>
        </label>
        <p className={caption}>その条件の最後のステップの後ろへ移ります</p>
        <div className="flex justify-end gap-2">
          {cancel}
          <button
            type="button"
            className={primaryBtn}
            disabled={target === ""}
            onClick={() => onCommit(joinBranchOps(model, stepId, target))}
          >
            枠に入れる
          </button>
        </div>
      </div>
    );
  }

  // mode === "arm": 「そうでなければ」の場合を足す
  const arms = armGroup ? groupArms(model, armGroup) : [];
  return (
    <div className="flex flex-col gap-3 rounded-md border border-black/10 p-3 dark:border-white/15">
      {altGroups.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className={caption}>どの場合分けに足しますか？</span>
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
                  .map((b) => `［${b.condition}］`)
                  .join(" / ")}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-300">
        {arms.map((b, i) => (
          <span key={b.id}>
            {i === 0 ? "もし" : "そうでなく"}［{b.condition}］なら …
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className={caption}>そうでないときの条件</span>
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs">そうでなく</span>
          <input
            autoFocus
            aria-label="そうでないときの条件"
            onFocus={caretToEnd}
            className={`${field} min-w-0 flex-1`}
            value={condition}
            placeholder="問題がない"
            onChange={(e) => setCondition(e.target.value)}
            onKeyDown={enter(submitArm)}
          />
          <span className="shrink-0 text-xs">なら</span>
        </div>
        <p className={caption}>→ {self}</p>
      </div>
      <div className="flex justify-end gap-2">
        {cancel}
        <button type="button" className={primaryBtn} disabled={!ready || armGroup === ""} onClick={submitArm}>
          場合を足す
        </button>
      </div>
    </div>
  );
}
