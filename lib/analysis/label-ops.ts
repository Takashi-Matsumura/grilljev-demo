import type { ExtractedActor, StepEditResult, StepLabelResult } from "@/lib/analysis/label";
import type { Actor, Branch, FlowModel, ModelOp, Step } from "@/lib/model/types";
import { canHaveMembers, memberOf } from "./assignee";
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
  /** 個人を列にせず、部署の担当者にした（{ 名前, 部署 }） */
  assigned: { name: string; into: string }[];
  /** 所属が分からず列にした個人。所属を尋ねる問いを足した */
  asked: string[];
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
  const assigned: ActorStepResult["assigned"] = [];
  const asked: string[] = [];
  let assignee: string | undefined;
  /** 部署に加えるメンバー（同じ部署に 2 人足すときも 1 回の update にまとめる） */
  const addMembers = new Map<string, string[]>();
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
    // 個人は列にしない: メンバーとして登録済みか、発言に所属が出ていれば、その部署の担当者にする
    if (found.kind === "person") {
      const dept =
        memberOf(model, found.name) ??
        model.actors.find((a) => a.name === found.affiliation && canHaveMembers(a) && a.kind !== "unknown");
      if (dept) {
        if (side === "from") assignee = found.name;
        if (!dept.members?.includes(found.name)) {
          addMembers.set(dept.id, [...(addMembers.get(dept.id) ?? dept.members ?? []), found.name]);
        }
        assigned.push({ name: found.name, into: dept.name });
        return dept.id;
      }
    }
    const id = nextId("A", pool.map((a) => a.id));
    pool.push({ id, name: found.name, aliases: [] });
    created.push({ id, name: found.name });
    ops.push({ op: "actor.add", actor: { id, name: found.name, kind: found.kind, aliases: [] } });
    if (found.kind === "person") asked.push(id);
    return id;
  };

  const fromId = resolve("from");
  const toId = resolve("to");
  if (!fromId || !toId) return null;
  for (const [id, members] of addMembers) ops.push({ op: "actor.update", id, patch: { members } });
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
      ...(assignee ? { assignee } : {}),
    },
  });

  // 所属が分からない個人は、いったん列にして、所属を尋ねる（答えに部署名が出たら、その部署にたたむ）
  const issueIds = model.issues.map((i) => i.id);
  for (const actorId of asked) {
    const name = pool.find((a) => a.id === actorId)?.name ?? "";
    const id = nextId("I", issueIds);
    issueIds.push(id);
    ops.push({
      op: "issue.add",
      issue: {
        id,
        question: `「${name}」さんは、どの部署・チームの方ですか？`,
        kind: "who",
        relatedStepIds: [stepId],
        status: "open",
        foldActorId: actorId,
      },
    });
  }
  return {
    ops,
    stepId,
    created,
    assigned,
    asked: asked.map((id) => pool.find((a) => a.id === id)?.name ?? id),
  };
}

export type EditPlan = {
  ops: ModelOp[];
  /** 名前が新しくなった・新しく足したステップ。次の Jev リクエストで発言に忠実かを検証する */
  labeled: { stepId: string; label: string }[];
  /** 画面に出す 1 行 */
  note: string;
};

/**
 * 手直し（gemma の結果）→ ModelOp。名前は gemma が返した登場人物名を、最新モデルの id に引き直す。
 * 前後に足すステップは、対象と隣のステップの order の間に入れる（order は実数）。分岐は対象と同じにする。
 * 対象が消えていれば null。
 */
export function buildEditOps(
  model: FlowModel,
  stepId: string,
  res: Pick<StepEditResult, "update" | "inserts">,
  utteranceId: string,
): EditPlan | null {
  const steps = sortedVisible(model);
  const index = steps.findIndex((s) => s.id === stepId);
  const step = steps[index];
  if (!step) return null;
  const idOf = (name: string) => model.actors.find((a) => a.name === name)?.id;

  const ops: ModelOp[] = [];
  const labeled: EditPlan["labeled"] = [];
  const notes: string[] = [];

  const patch: Partial<Step> = {};
  const { update } = res;
  if (update.label) {
    patch.label = update.label;
    labeled.push({ stepId, label: update.label });
    notes.push(`名前を「${update.label}」に`);
  }
  for (const side of ["from", "to"] as const) {
    const name = update[side];
    const id = name ? idOf(name) : undefined;
    if (name && id && id !== step[side]) {
      patch[side] = id;
      notes.push(`${side === "from" ? "行う側" : "相手"}を「${name}」に`);
    }
  }
  if (update.artifact !== undefined) {
    patch.artifact = update.artifact ?? undefined;
    notes.push(update.artifact ? `渡すものを「${update.artifact}」に` : "渡すものを無しに");
  }
  if (patch.from !== undefined || patch.to !== undefined) {
    const from = patch.from ?? step.from;
    const to = patch.to ?? step.to;
    if (from === to) patch.kind = "self";
    else if (step.kind === "self") patch.kind = "sync";
  }
  // 人が声で直したものなので、仮のステップも確定にする
  if (Object.keys(patch).length > 0) {
    ops.push({ op: "step.update", id: stepId, patch: { ...patch, status: "confirmed", confidence: 1 } });
  }

  const ids = model.steps.map((s) => s.id);
  for (const position of ["before", "after"] as const) {
    const adds = res.inserts.filter((x) => x.position === position);
    if (adds.length === 0) continue;
    const neighbor = steps[position === "before" ? index - 1 : index + 1];
    const lo = position === "before" ? (neighbor?.order ?? step.order - 1) : step.order;
    const hi = position === "before" ? step.order : (neighbor?.order ?? step.order + 1);
    adds.forEach((x, i) => {
      const from = idOf(x.from);
      const to = idOf(x.to);
      if (!from || !to) return;
      const id = nextId("S", ids);
      ids.push(id);
      ops.push({
        op: "step.add",
        step: {
          id,
          from,
          to,
          label: x.label,
          kind: from === to ? "self" : "sync",
          ...(x.artifact ? { artifact: x.artifact } : {}),
          branchId: step.branchId,
          order: lo + ((hi - lo) * (i + 1)) / (adds.length + 1),
          confidence: 1,
          status: "confirmed",
          flags: {},
          sourceUtteranceIds: [utteranceId],
        },
      });
      labeled.push({ stepId: id, label: x.label });
      notes.push(`${position === "before" ? "前" : "後"}に「${x.label}」を追加`);
    });
  }

  return { ops, labeled, note: notes.join("、") };
}
