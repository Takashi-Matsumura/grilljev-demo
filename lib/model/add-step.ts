import { visibleSteps } from "../render/mermaid";
import { nextOrder } from "./reducer";
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
 * ステップを 1 つ足す op。afterStepId を渡すと、図の並びでそのステップの直後に入れる
 * （order は直後のステップとの中点）。渡さない・見つからないときは末尾。
 * 前後が同じ分岐の中なら、その分岐に入れる。
 */
export function addStepOp(model: FlowModel, input: StepInput, afterStepId?: StepId | null): ModelOp {
  const steps = visibleSteps(model);
  const at = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : -1;
  const prev = at >= 0 ? steps[at] : undefined;
  const next = at >= 0 ? steps[at + 1] : undefined;
  const order = prev ? (next ? (prev.order + next.order) / 2 : prev.order + 1) : nextOrder(model);
  const branchId = prev && next && prev.branchId === next.branchId ? prev.branchId : null;
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
