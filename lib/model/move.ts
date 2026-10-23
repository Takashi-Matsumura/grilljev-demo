import type { Branch, ModelOp, Step } from "./types";

/**
 * 図の並び（visibleSteps の順）で index のステップを、insertAt の位置へ移す ops。
 * insertAt は「移す前の並びで、何番目のステップの手前に入れるか」（0 = 先頭、steps.length = 末尾）。
 *
 * order は実数なので、移した先の前後のステップの間の値にする（他のステップは動かさない）。
 * 分岐は、前後が同じ分岐ならその分岐に入れる。前後のどちらかが元の分岐なら元のまま、
 * どちらとも違えば分岐の外に出す（分岐の枠の外へ落としたのに、枠ごと付いてこないように）。
 *
 * `target` を渡すと、落とした点が図のどの場合の中にあったか（null = どの枠の外）で決める。枠の下端の
 * 「最後のステップの直後」と「枠の直後」は同じ並びの位置なので、位置だけでは分からないため。
 * ただし入れた先の場合の手順と隣り合わないなら（枠が 2 つに割れるので）使わず、上の決め方に戻す。
 * 位置も分岐も変わらなければ []。
 */
export function moveStepOps(steps: Step[], index: number, insertAt: number, target?: Branch | null): ModelOp[] {
  const step = steps[index];
  if (!step || insertAt < 0 || insertAt > steps.length) return [];
  const samePlace = insertAt === index || insertAt === index + 1;
  // 場合の指定が無ければ、同じ位置への移動は何もしない（分岐だけを変える手がかりが無い）
  if (samePlace && target === undefined) return [];

  const rest = steps.filter((_, i) => i !== index);
  const at = insertAt > index ? insertAt - 1 : insertAt;
  const prev = rest[at - 1];
  const next = rest[at];
  const order =
    prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : step.order;

  let branchId: string | null;
  const targetId = target === undefined ? undefined : (target?.id ?? null);
  const fits =
    targetId === undefined
      ? false
      : targetId === null
        ? !(prev && next && prev.branchId !== null && prev.branchId === next.branchId)
        : prev?.branchId === targetId || next?.branchId === targetId;
  if (fits) branchId = targetId ?? null;
  else if (prev && next && prev.branchId === next.branchId) branchId = prev.branchId;
  else if (step.branchId !== null && (prev?.branchId === step.branchId || next?.branchId === step.branchId)) {
    branchId = step.branchId;
  } else branchId = null;

  if (samePlace && branchId === step.branchId) return [];
  if (samePlace) return [{ op: "step.update", id: step.id, patch: { branchId } }];
  return [
    {
      op: "step.update",
      id: step.id,
      patch: branchId === step.branchId ? { order } : { order, branchId },
    },
  ];
}
