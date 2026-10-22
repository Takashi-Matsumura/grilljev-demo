import { visibleSteps } from "../render/mermaid";
import { endOrder, orderInArm, orderJustAfter } from "./branch";
import type { ActorId, FlowModel, ModelOp, StepId } from "./types";

/** 手で足すステップの入力（/editor のステップ追加フォーム。後で音声からも同じ形で渡す）。 */
export type StepInput = {
  from: ActorId;
  to: ActorId;
  label: string;
  /** 受け渡す書類・データ・ファイル（図の帯） */
  artifact?: string;
  /** 仮のステップ（点線）にする */
  provisional?: boolean;
};

/** 次のステップ id。取り消したステップも含めて数える（元に戻したときに重ならないように）。 */
export function nextStepId(model: FlowModel): StepId {
  const used = model.steps.map((s) => Number(/^S(\d+)$/.exec(s.id)?.[1] ?? 0));
  return `S${Math.max(0, ...used) + 1}`;
}

/**
 * ステップを 1 つ足す op。afterStepId を渡すと、図の並びでそのステップの直後に入れる。
 * 渡さない・見つからないときは末尾。前後が同じ枠の中なら、前のステップと同じ場合に入れる。
 * into（場合の id）を渡すと、その場合の最後に入れる（空の枠の「＋ ここにステップを追加」）。
 */
export function addStepOp(
  model: FlowModel,
  input: StepInput,
  afterStepId?: StepId | null,
  into?: string | null,
): ModelOp {
  const steps = visibleSteps(model);
  const intoOrder = into ? orderInArm(model, into) : undefined;
  const at = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : -1;
  const prev = at >= 0 ? steps[at] : undefined;
  const next = at >= 0 ? steps[at + 1] : undefined;
  const groupOf = new Map(model.branches.map((b) => [b.id, b.groupId]));
  const group = (id: string | null) => (id ? groupOf.get(id) : undefined);
  let branchId: string | null = null;
  let order: number;
  if (into && intoOrder !== undefined) {
    branchId = into;
    order = intoOrder;
  } else if (prev) {
    // 枠の途中（同じ枠の別の場合との境目も）に入れたら、前のステップの場合に入れる（枠が割れないように）
    if (next && prev.branchId !== null && group(prev.branchId) === group(next.branchId)) branchId = prev.branchId;
    order = branchId ? (prev.order + next!.order) / 2 : orderJustAfter(model, prev.order);
  } else order = endOrder(model);
  const artifact = input.artifact?.replace(/\s+/g, " ").trim();
  return {
    op: "step.add",
    step: {
      id: nextStepId(model),
      from: input.from,
      to: input.to,
      label: input.label.replace(/\s+/g, " ").trim(),
      kind: input.from === input.to ? "self" : "sync",
      ...(artifact ? { artifact } : {}),
      branchId,
      order,
      confidence: input.provisional ? 0.5 : 1,
      status: input.provisional ? "provisional" : "confirmed",
      flags: {},
      sourceUtteranceIds: [],
    },
  };
}

