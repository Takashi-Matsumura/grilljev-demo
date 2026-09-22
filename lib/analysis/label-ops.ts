import type { ExtractedActor, StepLabelResult } from "@/lib/analysis/label";
import type { Actor, Branch, FlowModel, ModelOp, Step } from "@/lib/model/types";
import { fallbackLabel, nextId, type FollowUp } from "./interpret";
import {
  ACTOR_APPLY,
  NEW_ACTOR_CONFIDENCE,
  SPECIFICITY_APPLY,
} from "./thresholds";

/**
 * gemma の結果 → ModelOp。純関数。
 *
 * gemma の応答は非同期で戻ってくるので、**適用する瞬間の最新モデル**を受け取り、
 * そこから id を採番する（リクエスト時点のモデルで採番すると、その間に足された分と衝突する）。
 */

/** 表記ゆれの比較用。空白と大文字小文字を無視する。 */
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function sortedVisible(model: FlowModel): Step[] {
  return model.steps
    .filter((s) => s.status !== "retracted")
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** 指定ステップの 1 つ前のステップが属している分岐（無ければ null）。else を付けるかの判断材料。 */
export function previousBranchOf(model: FlowModel, stepId: string): Branch | null {
  const steps = sortedVisible(model);
  const idx = steps.findIndex((s) => s.id === stepId);
  const prev = idx > 0 ? steps[idx - 1] : undefined;
  if (!prev?.branchId) return null;
  return model.branches.find((b) => b.id === prev.branchId) ?? null;
}

/** ステップ名・書類名・分岐を、追加済みのステップに付ける。 */
export function buildLabelOps(
  model: FlowModel,
  stepId: string,
  res: Pick<StepLabelResult, "label" | "artifact" | "branch">,
): ModelOp[] {
  const step = model.steps.find((s) => s.id === stepId && s.status !== "retracted");
  if (!step) return []; // 取り消された・消えた
  const ops: ModelOp[] = [];
  const patch: Partial<Step> = { label: res.label };
  if (res.artifact && !step.artifact) patch.artifact = res.artifact;

  if (res.branch && step.branchId === null) {
    const previous = previousBranchOf(model, stepId);
    const id = nextId("B", model.branches.map((b) => b.id));
    let branch: Branch;
    if (res.branch.relation === "else" && previous && previous.kind === "alt") {
      const index =
        model.branches
          .filter((b) => b.groupId === previous.groupId)
          .reduce((m, b) => Math.max(m, b.index), 0) + 1;
      branch = { id, kind: "alt", condition: res.branch.condition, groupId: previous.groupId, index };
    } else {
      branch = {
        id,
        kind: res.branch.kind,
        condition: res.branch.condition,
        groupId: nextId("G", model.branches.map((b) => b.groupId)),
        index: 0,
      };
    }
    ops.push({ op: "branch.add", branch });
    patch.branchId = id;
  }

  ops.push({ op: "step.update", id: stepId, patch });
  return ops;
}

export type ActorPlan = Extract<FollowUp, { kind: "actors" }> & {
  utterance: string;
  utteranceId: string;
};

export type ActorStepResult = {
  ops: ModelOp[];
  stepId: string;
  /** 新しく作ったアクター。次の Jev リクエストで「既存の言い換えではないか」を検証する */
  created: { id: string; name: string }[];
};

/**
 * 新しい登場人物の名前が分かったあとで、アクター（必要なら）とステップを追加する。
 * gemma が既知のアクターと同じ名前を返したら、新しく作らず既存を使う。
 * どちらかの名前が特定できなければ null（何も足さない）。
 */
export function buildActorStepOps(
  model: FlowModel,
  plan: ActorPlan,
  extracted: { from: ExtractedActor | null; to: ExtractedActor | null },
): ActorStepResult | null {
  const ops: ModelOp[] = [];
  const created: { id: string; name: string }[] = [];
  const pool: Pick<Actor, "id" | "name" | "aliases">[] = model.actors.map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases,
  }));

  const resolve = (side: "from" | "to"): string | null => {
    if (!plan.need[side]) return side === "from" ? plan.fromId : plan.toId;
    const found = extracted[side];
    if (!found) return null;
    const existing = pool.find(
      (a) => norm(a.name) === norm(found.name) || a.aliases.some((x) => norm(x) === norm(found.name)),
    );
    if (existing) return existing.id;
    const id = nextId("A", pool.map((a) => a.id));
    pool.push({ id, name: found.name, aliases: [] });
    created.push({ id, name: found.name });
    ops.push({ op: "actor.add", actor: { id, name: found.name, kind: found.kind, aliases: [] } });
    return id;
  };

  const fromId = resolve("from");
  const toId = resolve("to");
  if (!fromId || !toId) return null;
  // 参照するアクターが消えていたら足さない（reducer も弾くが、ここで明示する）
  if (!pool.some((a) => a.id === fromId) || !pool.some((a) => a.id === toId)) return null;

  const kind = fromId === toId ? "self" : plan.messageKind === "self" ? "sync" : plan.messageKind;
  const isNewActor = created.length > 0;
  // 名前を見つけたばかりのアクターを含むステップは、検証が済むまで仮にする
  const provisional =
    isNewActor || plan.confidence < ACTOR_APPLY || plan.specificity < SPECIFICITY_APPLY;
  const confidence = isNewActor ? Math.min(plan.confidence, NEW_ACTOR_CONFIDENCE) : plan.confidence;

  const stepId = nextId("S", model.steps.map((s) => s.id));
  ops.push({
    op: "step.add",
    step: {
      id: stepId,
      from: fromId,
      to: toId,
      label: fallbackLabel(plan.utterance),
      kind,
      branchId: null,
      order: model.steps.reduce((m, s) => Math.max(m, s.order), 0) + 1,
      confidence,
      status: provisional ? "provisional" : "confirmed",
      flags: plan.flags,
      sourceUtteranceIds: [plan.utteranceId],
    },
  });
  return { ops, stepId, created };
}
