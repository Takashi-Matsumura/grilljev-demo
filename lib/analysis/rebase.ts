import type { FlowModel, ModelOp } from "@/lib/model/types";
import { nextId, type FollowUp } from "./interpret";

/**
 * jev の解釈が返した ops を、**適用する瞬間の最新モデル**に合わせて採番し直す。
 *
 * 解釈はリクエスト時点のモデルで id と order を決めるが、その間に gemma の後続処理が
 * ステップを足していることがある（gemma は非同期で、jev の待ち行列を止めない設計）。
 * そのまま適用すると id が衝突し、reducer は重複として無視する（=ステップが黙って消え、
 * 後続のステップ名生成が別のステップに名前を付けてしまう）。
 *
 * 採番し直すのは新規追加（step.add / issue.add）の id と、ステップの order だけ。
 * 既存の要素を指す op（step.update / step.retract / issue.resolve / actor.merge）は
 * 触らない — それらは最新モデルにすでにある id を指している。
 */
export function rebaseOps(
  model: FlowModel,
  ops: ModelOp[],
  followUps: FollowUp[],
): { ops: ModelOp[]; followUps: FollowUp[] } {
  const stepIds = model.steps.map((s) => s.id);
  const issueIds = model.issues.map((i) => i.id);
  let order = model.steps.reduce((m, s) => Math.max(m, s.order), 0);
  const stepMap = new Map<string, string>();

  const rebased = ops.map((op): ModelOp => {
    if (op.op === "step.add") {
      const id = nextId("S", stepIds);
      stepIds.push(id);
      order += 1;
      stepMap.set(op.step.id, id);
      return { op: "step.add", step: { ...op.step, id, order } };
    }
    return op;
  });

  const withIssues = rebased.map((op): ModelOp => {
    if (op.op !== "issue.add") return op;
    const id = nextId("I", issueIds);
    issueIds.push(id);
    return {
      op: "issue.add",
      issue: {
        ...op.issue,
        id,
        // 同じバッチで足すステップを指している場合だけ付け替える
        relatedStepIds: op.issue.relatedStepIds.map((s) => stepMap.get(s) ?? s),
      },
    };
  });

  return {
    ops: withIssues,
    followUps: followUps.map((fu) =>
      fu.kind === "label" ? { ...fu, stepId: stepMap.get(fu.stepId) ?? fu.stepId } : fu,
    ),
  };
}
