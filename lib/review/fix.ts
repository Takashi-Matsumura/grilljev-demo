import type { Branch, FlowModel, ModelOp, Step } from "@/lib/model/types";
import { drawnFrames, visibleSteps } from "@/lib/render/mermaid";
import { isActionCondition, singlePersonSteps, syncSendSteps, terseSteps, type Finding } from "./rules";

/**
 * 点検の指摘に添える「直す案」。純関数。
 *
 * 案は図の差分（ModelOp）と、人が読む「前 → 後」の一覧の組。案は勝手には当てない: 点検のパネルで
 * 「図で見る」（モデルを変えずに画面の図だけ映す）・「この案で直す」（1 回で当て、元に戻す 1 回で戻る）を選んでもらう。
 *
 * コードで確実に作れるもの（矢印の種類・印）はここで作る。言い換え（分岐の条件・短いステップ名）は
 * AI に書かせ（fix-ai.ts）、その出力をここで確かめて案にする（buildAiFix）。
 */

export type FixChange = { before: string; after: string };
export type Fix = { ops: ModelOp[]; changes: FixChange[] };

/** code = コードで作る / ai = AI に言い換えを書かせる */
export type FixKind = "code" | "ai";

export function fixKindOf(f: Pick<Finding, "id" | "source">): FixKind | null {
  if (f.source !== "rule") return null;
  if (f.id === "notation-sync-send" || f.id.startsWith("flow-single-person:")) return "code";
  if (f.id.startsWith("notation-condition:") || f.id === "notation-terse-label") return "ai";
  return null;
}

const numberOf = (model: FlowModel) => new Map(visibleSteps(model).map((s, i) => [s.id, i + 1]));
const stepText = (no: Map<string, number>, s: Step, label = s.label) => `${no.get(s.id)}「${label}」`;

/** コードで作る案。当てはまる手順が無くなっていれば null */
export function codeFix(model: FlowModel, f: Pick<Finding, "id">): Fix | null {
  const no = numberOf(model);
  if (f.id === "notation-sync-send") {
    const steps = syncSendSteps(model);
    if (steps.length === 0) return null;
    return {
      ops: steps.map((s) => ({ op: "step.update", id: s.id, patch: { kind: "async" } })),
      changes: steps.map((s) => ({ before: `${stepText(no, s)} 依頼（返事を待つ）`, after: "通知（送るだけ）" })),
    };
  }
  if (f.id.startsWith("flow-single-person:")) {
    const single = singlePersonSteps(model, f.id.slice("flow-single-person:".length));
    if (!single) return null;
    return {
      ops: single.steps.map((s) => ({
        op: "step.update",
        id: s.id,
        patch: { flags: { ...s.flags, personDependent: true } },
      })),
      changes: single.steps.map((s) => ({ before: stepText(no, s), after: `${stepText(no, s)}［属人］` })),
    };
  }
  return null;
}

/** AI に言い換えさせる相手。分岐の条件（動作の名前になっているもの）か、短いステップ名 */
export type AiFixTarget =
  | { kind: "condition"; arms: Branch[]; frame: Branch[] }
  | { kind: "label"; steps: Step[] };

export function aiFixTarget(model: FlowModel, findingId: string): AiFixTarget | null {
  if (findingId.startsWith("notation-condition:")) {
    const groupId = findingId.slice("notation-condition:".length);
    const frame = drawnFrames(model).find((arms) => arms[0].groupId === groupId);
    const arms = frame?.filter(isActionCondition) ?? [];
    return frame && arms.length > 0 ? { kind: "condition", arms, frame } : null;
  }
  if (findingId === "notation-terse-label") {
    const steps = terseSteps(model);
    return steps.length > 0 ? { kind: "label", steps } : null;
  }
  return null;
}

export const MAX_CONDITION_CHARS = 30;
export const MAX_LABEL_CHARS = 40;

/** 言い換えの 1 つ。囲みの括弧・かぎ括弧と空白を除く。空・長すぎるものは null */
const phrase = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[［\[「『]+|[］\]」』]+$/g, "")
    .trim();
  return s === "" || [...s].length > max ? null : s;
};

/**
 * AI の言い換え（`{"conditions": {"B1": "…"}}` / `{"labels": {"S3": "…"}}`）を確かめて案にする。
 * 信用しない: 知らない id・空・長すぎる・元と同じものは捨てる。条件は、言い換えてもまだ動作の名前に
 * 読めるなら捨てる。ステップ名は、元より短いものは捨てる（短くて意味が取りにくい、という指摘なので）。
 * 1 つも残らなければ null
 */
export function buildAiFix(model: FlowModel, target: AiFixTarget, json: unknown): Fix | null {
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (target.kind === "condition") {
    const out = (typeof j.conditions === "object" && j.conditions !== null ? j.conditions : {}) as Record<string, unknown>;
    const fix: Fix = { ops: [], changes: [] };
    for (const arm of target.arms) {
      const next = phrase(out[arm.id], MAX_CONDITION_CHARS);
      if (!next || next === arm.condition.trim() || isActionCondition({ ...arm, condition: next })) continue;
      fix.ops.push({ op: "branch.update", id: arm.id, patch: { condition: next } });
      fix.changes.push({ before: `［${arm.condition}］`, after: `［${next}］` });
    }
    return fix.ops.length > 0 ? fix : null;
  }
  const out = (typeof j.labels === "object" && j.labels !== null ? j.labels : {}) as Record<string, unknown>;
  const no = numberOf(model);
  const fix: Fix = { ops: [], changes: [] };
  for (const s of target.steps) {
    const next = phrase(out[s.id], MAX_LABEL_CHARS);
    if (!next || next === s.label.trim() || [...next].length <= [...s.label.trim()].length) continue;
    fix.ops.push({ op: "step.update", id: s.id, patch: { label: next } });
    fix.changes.push({ before: stepText(no, s), after: stepText(no, s, next) });
  }
  return fix.ops.length > 0 ? fix : null;
}
