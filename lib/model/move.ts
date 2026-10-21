import type { ModelOp, Step } from "./types";

/**
 * 図の並び（visibleSteps の順）で index のステップを、insertAt の位置へ移す ops。
 * insertAt は「移す前の並びで、何番目のステップの手前に入れるか」（0 = 先頭、steps.length = 末尾）。
 *
 * order は実数なので、移した先の前後のステップの間の値にする（他のステップは動かさない）。
 * 分岐は、前後が同じ分岐ならその分岐に入れる。前後のどちらかが元の分岐なら元のまま、
 * どちらとも違えば分岐の外に出す（分岐の枠の外へ落としたのに、枠ごと付いてこないように）。
 * 位置が変わらなければ []。
 */
export function moveStepOps(steps: Step[], index: number, insertAt: number): ModelOp[] {
  const step = steps[index];
  if (!step || insertAt < 0 || insertAt > steps.length) return [];
  if (insertAt === index || insertAt === index + 1) return [];

  const rest = steps.filter((_, i) => i !== index);
  const at = insertAt > index ? insertAt - 1 : insertAt;
  const prev = rest[at - 1];
  const next = rest[at];
  const order =
    prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : step.order;

  let branchId: string | null;
  if (prev && next && prev.branchId === next.branchId) branchId = prev.branchId;
  else if (step.branchId !== null && (prev?.branchId === step.branchId || next?.branchId === step.branchId)) {
    branchId = step.branchId;
  } else branchId = null;

  return [
    {
      op: "step.update",
      id: step.id,
      patch: branchId === step.branchId ? { order } : { order, branchId },
    },
  ];
}
