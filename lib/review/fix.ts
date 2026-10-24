import { addStepOp } from "@/lib/model/add-step";
import { applyOps } from "@/lib/model/reducer";
import type { Actor, Branch, FlowModel, ModelOp, Scope, Step } from "@/lib/model/types";
import { drawnFrames, visibleSteps } from "@/lib/render/mermaid";
import { isActionCondition, singlePersonSteps, syncSendSteps, terseSteps, type Finding } from "./rules";

/**
 * 点検の指摘に添える「直す案」。純関数。
 *
 * 案は図の差分（ModelOp）と、人が読む「前 → 後」の一覧の組。案は勝手には当てない: 点検のパネルで
 * 「図で見る」（モデルを変えずに画面の図だけ映す）・「この案で直す」（1 回で当て、元に戻す 1 回で戻る）を選んでもらう。
 *
 * コードで確実に作れるもの（矢印の種類・印）はここで作る。AI に書かせるもの（分岐の条件・短いステップ名の
 * 言い換え、業務の前提の下書き、抜けている手順）は fix-ai.ts で頼み、その出力をここで確かめて案にする（buildAiFix）。
 * AI が足す手順は、すべて「仮」（点線）にする。チームで確かめて「確定」にしてもらう
 */

/** add = 足すもの（before は足す場所） */
export type FixChange = { before: string; after: string; add?: true };
export type Fix = { ops: ModelOp[]; changes: FixChange[] };

/** code = コードで作る / ai = AI に言い換えを書かせる */
export type FixKind = "code" | "ai";

/** 直す案を作るのに要る、指摘の中身（AI の指摘は図の外から届くので、これを渡す） */
export type FixableFinding = Pick<Finding, "id" | "source" | "category" | "title" | "detail" | "steps">;

export function fixKindOf(f: Pick<Finding, "id" | "source" | "category" | "title">): FixKind | null {
  // AI の指摘のうち業務の流れ（抜けている手順・例外）は、仮の手順を足す案にする
  if (f.source === "ai") return f.category === "flow" ? "ai" : null;
  if (f.id === "notation-sync-send" || f.id.startsWith("flow-single-person:")) return "code";
  if (f.id.startsWith("notation-condition:") || f.id === "notation-terse-label") return "ai";
  // 前提は目的・きっかけだけを下書きする（頻度は図から読めず、書かせると数字を作る）
  if (f.id === "premise-missing") return /目的|きっかけ/.test(f.title) ? "ai" : null;
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

/** 業務の前提のうち、AI に下書きさせる欄 */
export type PremiseField = keyof Pick<Scope, "purpose" | "trigger">;
export const PREMISE_LABEL: Record<PremiseField, string> = { purpose: "目的", trigger: "きっかけ" };

/**
 * AI に書かせる相手。分岐の条件（動作の名前になっているもの）・短いステップ名の言い換え、
 * 業務の前提の下書き、指摘に応える仮の手順
 */
export type AiFixTarget =
  | { kind: "condition"; arms: Branch[]; frame: Branch[] }
  | { kind: "label"; steps: Step[] }
  | { kind: "premise"; fields: PremiseField[] }
  | { kind: "steps"; finding: Pick<Finding, "title" | "detail" | "steps"> };

export function aiFixTarget(model: FlowModel, finding: FixableFinding): AiFixTarget | null {
  if (fixKindOf(finding) !== "ai") return null;
  const findingId = finding.id;
  if (finding.source === "ai") {
    return visibleSteps(model).length > 0 && model.actors.length > 0
      ? { kind: "steps", finding: { title: finding.title, detail: finding.detail, steps: finding.steps } }
      : null;
  }
  if (findingId === "premise-missing") {
    const fields = (["purpose", "trigger"] as const).filter((k) => !model.scope[k].trim());
    return fields.length > 0 ? { kind: "premise", fields } : null;
  }
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
export const MAX_PREMISE_CHARS = 60;
export const MAX_ARTIFACT_CHARS = 30;
/** 1 つの指摘に足す手順の上限。多いと確かめきれない */
export const MAX_ADDED_STEPS = 3;
export const MAX_REASON_CHARS = 80;

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

/** 中身をぼかす修飾語。「最終的な処理を承認する」「必要な対応をする」は、何をするのかが読み取れない */
const VAGUE_WORDS = /(最終的な|最終的に|必要な|必要に応じて|適切な|適切に|適宜|所定の|各種|諸々|もろもろ|色々|いろいろ|何らか|処理内容|作業内容)/;
/** 汎用の言葉だけで、何をするのかが無い名前（「処理する」「対応する」「作業を行う」）。「支払処理を行う」は残す */
const GENERIC_ONLY = /^(処理|対応|作業|手続き|業務|確認作業)(を)?(する|行う|実施する)?$/;

/**
 * 手順名として、何をするのかがぼやけているか。AI に書かせた手順名（足す手順・言い換え）に使う。
 * プロンプトで「ぼかした言葉は使わない」と頼んでも書いてきた（「最終的な処理を承認する」。実測）ので、コードで捨てる
 */
export function isVagueLabel(label: string): boolean {
  const s = label.replace(/\s+/g, "");
  return VAGUE_WORDS.test(s) || GENERIC_ONLY.test(s);
}

/**
 * AI の言い換え（`{"conditions": {"B1": "…"}}` / `{"labels": {"S3": "…"}}`）を確かめて案にする。
 * 信用しない: 知らない id・空・長すぎる・元と同じものは捨てる。条件は、言い換えてもまだ動作の名前に
 * 読めるなら捨てる。ステップ名は、元より短いもの（短くて意味が取りにくい、という指摘なので）と、
 * 何をするのかがぼやけたもの（isVagueLabel）を捨てる。
 * 前提の下書きは、頼んだ欄（空の欄）だけ。足す手順は addedSteps を見る。
 * 1 つも残らなければ null
 */
export function buildAiFix(model: FlowModel, target: AiFixTarget, json: unknown): Fix | null {
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (target.kind === "steps") return addedSteps(model, j.steps);
  if (target.kind === "premise") {
    const patch: Partial<Scope> = {};
    const changes: FixChange[] = [];
    for (const field of target.fields) {
      const next = phrase(j[field], MAX_PREMISE_CHARS);
      if (!next) continue;
      patch[field] = next;
      changes.push({ before: `${PREMISE_LABEL[field]}: （空）`, after: `${PREMISE_LABEL[field]}: ${next}` });
    }
    return changes.length > 0 ? { ops: [{ op: "scope.set", patch }], changes } : null;
  }
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
    if (!next || next === s.label.trim() || [...next].length <= [...s.label.trim()].length || isVagueLabel(next)) continue;
    fix.ops.push({ op: "step.update", id: s.id, patch: { label: next } });
    fix.changes.push({ before: stepText(no, s), after: stepText(no, s, next) });
  }
  return fix.ops.length > 0 ? fix : null;
}

/**
 * 足す手順の案で、AI が「手順を足しても応えられない」と答えたか（`{"steps": [], "reason": "…"}`）。
 * 答えたなら理由（書いていなければ ""）。足す手順を書いた・形が違う（＝案を捨てた）なら null。
 * 応えられない指摘（どこから再開するかを決める、など）は、頼み直しても同じなので、画面で頼み直させない
 */
export function declinedOf(target: AiFixTarget, json: unknown): string | null {
  if (target.kind !== "steps") return null;
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  if (!Array.isArray(j.steps) || j.steps.length > 0) return null;
  return phrase(j.reason, MAX_REASON_CHARS) ?? "";
}

const norm = (v: string) => v.replace(/\s+/g, "").trim();

/** 名前か別名で登場人物を見つける（AI は図の名前をそのまま書くよう頼んでいる） */
function actorByName(model: FlowModel, name: unknown): Actor | undefined {
  if (typeof name !== "string" || norm(name) === "") return undefined;
  const n = norm(name);
  return model.actors.find((a) => norm(a.name) === n) ?? model.actors.find((a) => a.aliases.some((x) => norm(x) === n));
}

/**
 * AI の「足す手順」（`[{"after": 4, "from": "経理部", "to": "会計システム", "label": "…", "artifact": "…"}]`）を
 * 確かめて案にする。登場人物は図にいる人だけ、after は図の番号（0 = 最初の手順の前）。図にもうある手順
 * （同じ送り手・受け手・名前）と、何をするのかがぼやけた名前（isVagueLabel）は足さない。
 * すべて「仮」で足す。同じ場所に 2 つ以上なら、書かれた順に続ける
 */
function addedSteps(model: FlowModel, list: unknown): Fix | null {
  if (!Array.isArray(list)) return null;
  const base = visibleSteps(model);
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const candidates = list.flatMap((raw, i) => {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const from = actorByName(model, o.from);
    const to = actorByName(model, o.to);
    const written = phrase(o.label, MAX_LABEL_CHARS);
    const label = written && !isVagueLabel(written) ? written : null;
    const after = o.after;
    if (!from || !to || !label || !Number.isInteger(after) || (after as number) < 0 || (after as number) > base.length) {
      return [];
    }
    if (base.some((s) => s.from === from.id && s.to === to.id && norm(s.label) === norm(label))) return [];
    const artifact = phrase(o.artifact, MAX_ARTIFACT_CHARS) ?? undefined;
    return [{ i, after: after as number, from, to, label, artifact }];
  });
  // 上限は AI が挙げた順で取り、入れるのは図の上から
  const picked = candidates.slice(0, MAX_ADDED_STEPS).sort((a, b) => a.after - b.after || a.i - b.i);
  if (picked.length === 0) return null;

  let work = model;
  const ops: ModelOp[] = [];
  const changes: FixChange[] = [];
  // 同じ場所に続けて足すときは、直前に足した手順の後ろへ
  const lastAt = new Map<number, string>();
  for (const c of picked) {
    const afterId = lastAt.get(c.after) ?? (c.after > 0 ? base[c.after - 1].id : null);
    const op = addStepOp(work, { from: c.from.id, to: c.to.id, label: c.label, artifact: c.artifact, provisional: true }, afterId);
    if (op.op !== "step.add") continue;
    // addStepOp は「直後」か末尾にしか入れないので、最初の手順の前は並び順で決める（枠の外に）
    if (afterId === null) {
      const first = visibleSteps(work)[0];
      op.step.order = (first?.order ?? 1) - 1;
      op.step.branchId = null;
    }
    ops.push(op);
    work = applyOps(work, [op], model.updatedAt);
    lastAt.set(c.after, op.step.id);
    const where = c.after === 0 ? "最初の手順の前" : `${c.after}「${base[c.after - 1].label}」の後`;
    const what = `${nameOf(c.from.id)} → ${nameOf(c.to.id)}: ${c.label}${c.artifact ? `（渡すもの: ${c.artifact}）` : ""}`;
    changes.push({ before: where, after: `${what}［仮］`, add: true });
  }
  return ops.length > 0 ? { ops, changes } : null;
}
