import { visibleSteps } from "../render/mermaid";
import type { Branch, FlowModel, ModelOp, Step, StepId } from "./types";

/**
 * 分岐（枠）を手で組み立てる ops。純粋関数（/editor の分岐の操作。後で音声からも同じ関数を使う）。
 *
 * 枠は「図の並びで連続しているステップ」を囲んで描かれる（toMermaid）。同じ枠（groupId）の
 * ステップが途中で途切れると枠が 2 つに割れるので、枠に出し入れするときは order も動かして、
 * 枠の中身が連続したままになるようにする。場合（alt の else）は index の順に並べる。
 */

export const BRANCH_KINDS: { kind: Branch["kind"]; label: string; hint: string }[] = [
  { kind: "alt", label: "場合分け", hint: "条件によってやることが変わる（もし〜なら / そうでなければ）" },
  { kind: "opt", label: "やるときだけ", hint: "条件を満たすときだけやる" },
  { kind: "loop", label: "繰り返し", hint: "条件を満たす間、繰り返す" },
];

export const branchKindLabel = (kind: Branch["kind"]) => BRANCH_KINDS.find((k) => k.kind === kind)?.label ?? kind;

function nextId(prefix: string, ids: string[]): string {
  const used = ids.map((id) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(id)?.[1] ?? 0));
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

/** 枠（groupId）の場合を index 順に */
export function groupArms(model: FlowModel, groupId: string): Branch[] {
  return model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
}

/** rest（並び）の at 番目の手前に入れるときの order */
function orderAt(rest: Step[], at: number, fallback: number): number {
  const prev = rest[at - 1];
  const next = rest[at];
  return prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : fallback;
}

/** step を抜いたあと、その場合に図に見えるステップが残らないなら、場合ごと消す op */
function dropIfEmpty(model: FlowModel, branchId: string | null, leaving: StepId): ModelOp[] {
  if (!branchId) return [];
  const left = visibleSteps(model).some((s) => s.branchId === branchId && s.id !== leaving);
  return left ? [] : [{ op: "branch.remove", id: branchId }];
}

/** 枠の外にあるステップを、新しい枠で囲む（その枠の最初の場合になる）。 */
export function wrapStepOps(model: FlowModel, stepId: StepId, kind: Branch["kind"], condition: string): ModelOp[] {
  const step = model.steps.find((s) => s.id === stepId);
  const text = condition.replace(/\s+/g, " ").trim();
  if (!step || step.branchId !== null || text === "") return [];
  const branch: Branch = {
    id: nextId("B", model.branches.map((b) => b.id)),
    kind,
    condition: text,
    groupId: nextId("G", model.branches.map((b) => b.groupId)),
    index: 0,
  };
  return [
    { op: "branch.add", branch },
    { op: "step.update", id: stepId, patch: { branchId: branch.id } },
  ];
}

/**
 * ステップを、ある場合（branchId）の中に入れる。その場合の最後のステップの後ろへ動かす。
 * 場合がまだ空なら、前の場合の後ろ（無ければ後ろの場合の手前）に置く。
 */
export function joinBranchOps(model: FlowModel, stepId: StepId, branchId: string): ModelOp[] {
  const steps = visibleSteps(model);
  const step = steps.find((s) => s.id === stepId);
  const branch = model.branches.find((b) => b.id === branchId);
  if (!step || !branch || step.branchId === branchId) return [];
  const rest = steps.filter((s) => s.id !== stepId);
  const indexOf = new Map(model.branches.map((b) => [b.id, b]));
  const inGroup = (s: Step, pick: (b: Branch) => boolean) => {
    const b = s.branchId ? indexOf.get(s.branchId) : undefined;
    return b !== undefined && b.groupId === branch.groupId && pick(b);
  };
  const lastOf = (pick: (b: Branch) => boolean) => rest.findLastIndex((s) => inGroup(s, pick));
  const firstOf = (pick: (b: Branch) => boolean) => rest.findIndex((s) => inGroup(s, pick));

  let at = lastOf((b) => b.id === branchId);
  if (at >= 0) at += 1;
  else {
    const before = lastOf((b) => b.index < branch.index);
    const after = firstOf((b) => b.index > branch.index);
    at = before >= 0 ? before + 1 : after >= 0 ? after : -1;
  }
  const order = at >= 0 ? orderAt(rest, at, step.order) : step.order;
  return [
    { op: "step.update", id: stepId, patch: { branchId, order } },
    ...dropIfEmpty(model, step.branchId, stepId),
  ];
}

/** 枠（alt）に新しい場合を足して、ステップをそこに入れる（「そうでなければ」）。 */
export function addArmOps(model: FlowModel, stepId: StepId, groupId: string, condition: string): ModelOp[] {
  const arms = groupArms(model, groupId);
  const text = condition.replace(/\s+/g, " ").trim();
  if (arms.length === 0 || arms[0].kind !== "alt" || text === "") return [];
  const branch: Branch = {
    id: nextId("B", model.branches.map((b) => b.id)),
    kind: "alt",
    condition: text,
    groupId,
    index: Math.max(...arms.map((b) => b.index)) + 1,
  };
  // join は branch.add の後の model で計算する（新しい場合の位置を決めるため）
  const added: FlowModel = { ...model, branches: [...model.branches, branch] };
  return [{ op: "branch.add", branch }, ...joinBranchOps(added, stepId, branch.id)];
}

/**
 * ステップを枠の外に出す。枠の先頭か末尾ならその場で外し、途中なら枠の直後へ動かす
 * （途中で外すと、枠が 2 つに割れるため）。
 */
export function leaveBranchOps(model: FlowModel, stepId: StepId): ModelOp[] {
  const steps = visibleSteps(model);
  const step = steps.find((s) => s.id === stepId);
  const branch = step?.branchId ? model.branches.find((b) => b.id === step.branchId) : undefined;
  if (!step || !branch) return [];
  const groupOf = new Map(model.branches.map((b) => [b.id, b.groupId]));
  const inGroup = (s: Step) => s.branchId !== null && groupOf.get(s.branchId) === branch.groupId;
  const first = steps.findIndex(inGroup);
  const last = steps.findLastIndex(inGroup);
  const i = steps.indexOf(step);
  const patch: Extract<ModelOp, { op: "step.update" }>["patch"] = { branchId: null };
  if (i !== first && i !== last) {
    const rest = steps.filter((s) => s.id !== stepId);
    patch.order = orderAt(rest, last, step.order); // last は step を抜くと 1 つ前にずれる＝枠の直後
  }
  return [{ op: "step.update", id: stepId, patch }, ...dropIfEmpty(model, branch.id, stepId)];
}

/** 枠ごとやめる（中のステップは残して、枠の外に出す）。 */
export function removeGroupOps(model: FlowModel, groupId: string): ModelOp[] {
  return groupArms(model, groupId).map((b) => ({ op: "branch.remove", id: b.id }));
}

/** 枠の種類を変える（場合が 2 つ以上あるのは場合分けだけなので、そのときは変えない）。 */
export function setGroupKindOps(model: FlowModel, groupId: string, kind: Branch["kind"]): ModelOp[] {
  const arms = groupArms(model, groupId);
  if (arms.length !== 1 || arms[0].kind === kind) return [];
  return [{ op: "branch.update", id: arms[0].id, patch: { kind } }];
}
