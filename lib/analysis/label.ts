import { extractJson } from "@/lib/json";
import { chatCompletion, LlmError } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import type { ActorKind } from "@/lib/model/types";

/**
 * gemma に「文言」を作らせる。server 専用。
 * gemma の出力は信用しない: 形・長さ・種別を検証し、駄目なら例外（呼び出し側は
 * 暫定の文言のまま見送る）。ここで作った文言は、次の Jev リクエストで必ず検証される。
 */

const MAX_LABEL_CHARS = 30;
const MAX_NAME_CHARS = 20;

const BRANCH_KINDS = ["alt", "opt", "loop"] as const;
const ACTOR_KINDS: ActorKind[] = ["person", "role", "system", "external"];

export type StepLabelInput = {
  utterance: string;
  from: string;
  to: string;
  messageKind: string;
  branchHint: boolean;
  previousBranch: { condition: string; kind: string } | null;
  /** 作り直しのとき、不適切と判断された以前の候補。これとは別の言い方にさせる */
  avoid?: string;
};

export type StepLabelResult = {
  label: string;
  artifact: string | null;
  branch: {
    condition: string;
    relation: "new" | "else";
    kind: (typeof BRANCH_KINDS)[number];
  } | null;
  ms: number;
};

export type ExtractedActor = {
  name: string;
  kind: ActorKind;
  /** 個人のとき、発言に出てきた所属（既知の登場人物の名前）。分からなければ無い */
  affiliation?: string;
};
export type ActorsResult = {
  from: ExtractedActor | null;
  to: ExtractedActor | null;
  ms: number;
};

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const s = value
    .replace(/^[「『"'\s]+|[」』"'\s。．.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s === "" || s === "null" || s === "なし") return null;
  return s.length > max ? null : s;
}

export async function labelStep(input: StepLabelInput): Promise<StepLabelResult> {
  const startedAt = performance.now();
  const system = await loadPrompt("label-step");
  const user = JSON.stringify({
    utterance: input.utterance,
    from: input.from,
    to: input.to,
    message_kind: input.messageKind,
    branch_hint: input.branchHint,
    previous_branch: input.previousBranch,
    ...(input.avoid ? { avoid: input.avoid } : {}),
  });
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 作り直しは温度を上げて、同じ文言が返らないようにする
    { maxTokens: 200, temperature: input.avoid ? 0.6 : 0.2 },
  );

  const json = extractJson(raw) as Record<string, unknown> | null;
  const label = json ? cleanText(json.label, MAX_LABEL_CHARS) : null;
  if (!label) throw new LlmError(`ステップ名を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");

  let branch: StepLabelResult["branch"] = null;
  const b = json?.branch as Record<string, unknown> | null | undefined;
  if (input.branchHint && b && typeof b === "object") {
    const condition = cleanText(b.condition, MAX_LABEL_CHARS);
    const relation = b.relation === "else" ? "else" : "new";
    const kind = (BRANCH_KINDS as readonly unknown[]).includes(b.kind)
      ? (b.kind as (typeof BRANCH_KINDS)[number])
      : "alt";
    // else は、対になる直前の分岐があるときだけ意味を持つ
    if (condition && (relation === "new" || input.previousBranch)) {
      branch = { condition, relation, kind: relation === "else" ? "alt" : kind };
    }
  }

  return {
    label,
    artifact: json ? cleanText(json.artifact, MAX_LABEL_CHARS) : null,
    branch,
    ms: Math.round(performance.now() - startedAt),
  };
}

function toActor(value: unknown, knownActors: string[]): ExtractedActor | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = cleanText(v.name, MAX_NAME_CHARS)?.replace(/(さん|様|氏)$/, "") ?? null;
  if (!name) return null;
  const kind = (ACTOR_KINDS as unknown[]).includes(v.kind) ? (v.kind as ActorKind) : "role";
  // 所属は既知の登場人物の名前だけ（gemma が作った部署名は使わない）
  const affiliation = kind === "person" ? cleanText(v.affiliation, MAX_NAME_CHARS) : null;
  return affiliation && knownActors.includes(affiliation) ? { name, kind, affiliation } : { name, kind };
}

export async function extractActors(input: {
  utterance: string;
  knownActors: string[];
  need: ("from" | "to")[];
}): Promise<ActorsResult> {
  const startedAt = performance.now();
  const system = await loadPrompt("extract-actors");
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          utterance: input.utterance,
          known_actors: input.knownActors,
          need: input.need,
        }),
      },
    ],
    { maxTokens: 150, temperature: 0.1 },
  );

  const json = extractJson(raw) as Record<string, unknown> | null;
  if (!json) throw new LlmError(`登場人物を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");
  return {
    from: input.need.includes("from") ? toActor(json.from, input.knownActors) : null,
    to: input.need.includes("to") ? toActor(json.to, input.knownActors) : null,
    ms: Math.round(performance.now() - startedAt),
  };
}

export type StepRenameResult = { label: string; ms: number };

/** 比べるための形。空白・括弧・句読点を除く（「請求書の 受付」と「請求書の受付」を同じに見る） */
const bare = (s: string) => s.replace(/[\s「」『』"'、。,.，．！!？?]/g, "");

/**
 * 言い直された新しいステップ名を、発言から取り出す（「1番の名前は請求書の受付です」→「請求書の受付」）。
 * 取り出した名前が**発言の中にそのまま無ければ採用しない**（gemma の言い換え・作り話を図に入れない）。
 */
export async function renameStep(input: { utterance: string; currentLabel: string }): Promise<StepRenameResult> {
  const startedAt = performance.now();
  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt("rename-step") },
      {
        role: "user",
        content: JSON.stringify({ utterance: input.utterance, current_label: input.currentLabel }),
      },
    ],
    { maxTokens: 100, temperature: 0.1 },
  );
  const json = extractJson(raw) as Record<string, unknown> | null;
  const label = json ? cleanText(json.label, MAX_LABEL_CHARS) : null;
  if (!label) throw new LlmError("発言から新しい名前を取り出せませんでした", "invalid");
  if (!bare(input.utterance).includes(bare(label))) {
    throw new LlmError(`取り出した名前「${label}」が発言に無いため、採用しませんでした`, "invalid");
  }
  if (bare(label) === bare(input.currentLabel)) {
    throw new LlmError("今の名前と同じです", "invalid");
  }
  return { label, ms: Math.round(performance.now() - startedAt) };
}

type StepView = { label: string; from: string; to: string; artifact: string | null };

export type StepEditInput = {
  utterance: string;
  /** 直前の発言（古い順）。whisper が 1 つの話を区切ったときの前半 */
  context: string[];
  step: StepView;
  before: StepView | null;
  after: StepView | null;
  actors: string[];
};

export type StepInsert = {
  position: "before" | "after";
  from: string;
  to: string;
  label: string;
  artifact: string | null;
};

export type StepEditResult = {
  /** 対象のステップの書き換え。変える項目だけ入る（artifact: null は「渡すものを無くす」） */
  update: Partial<{ label: string; from: string; to: string; artifact: string | null }>;
  inserts: StepInsert[];
  /** 検証で採用しなかったもの（画面で理由を見せる） */
  dropped: string[];
  ms: number;
};

const MAX_INSERTS = 2;

/**
 * 決まった直し方に当てはまらない訂正（渡すものを変える・前後に手順を足す など）を、gemma に決めさせる。
 * gemma の出力は信用しない:
 * - 登場人物は、図にいる名前だけ（新しい人は作らない）
 * - 渡すもの（artifact）は、発言にそのまま出てくる言い方だけ（作り話を図に入れない）
 * - ステップ名は、次の Jev リクエストで発言に忠実かを検証する（呼び出し側）
 */
export async function editStep(input: StepEditInput): Promise<StepEditResult> {
  const startedAt = performance.now();
  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt("edit-step") },
      { role: "user", content: JSON.stringify(input) },
    ],
    { maxTokens: 300, temperature: 0.1 },
  );
  const json = extractJson(raw) as Record<string, unknown> | null;
  if (!json) throw new LlmError(`直し方を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");

  const spoken = bare([...input.context, input.utterance].join(""));
  const dropped: string[] = [];
  const actor = (v: unknown): string | null => {
    const name = cleanText(v, MAX_NAME_CHARS);
    if (name === null) return null;
    if (input.actors.includes(name)) return name;
    dropped.push(`図にいない登場人物「${name}」`);
    return null;
  };
  const artifactOf = (v: unknown): string | null | undefined => {
    if (v === null) return null;
    const a = cleanText(v, MAX_LABEL_CHARS);
    if (a === null) return undefined;
    if (spoken.includes(bare(a))) return a;
    dropped.push(`発言に無い書類名「${a}」`);
    return undefined;
  };

  const update: StepEditResult["update"] = {};
  const u = json.update;
  if (u && typeof u === "object") {
    const o = u as Record<string, unknown>;
    const label = cleanText(o.label, MAX_LABEL_CHARS);
    if (label && bare(label) !== bare(input.step.label)) update.label = label;
    const from = "from" in o ? actor(o.from) : null;
    if (from && from !== input.step.from) update.from = from;
    const to = "to" in o ? actor(o.to) : null;
    if (to && to !== input.step.to) update.to = to;
    if ("artifact" in o) {
      const a = artifactOf(o.artifact);
      if (a !== undefined && a !== input.step.artifact) update.artifact = a;
    }
  }

  const inserts: StepInsert[] = [];
  for (const v of Array.isArray(json.insert) ? json.insert.slice(0, MAX_INSERTS) : []) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const from = actor(o.from);
    const to = actor(o.to);
    const label = cleanText(o.label, MAX_LABEL_CHARS);
    if (!from || !to || !label) continue;
    inserts.push({
      position: o.position === "after" ? "after" : "before",
      from,
      to,
      label,
      artifact: artifactOf(o.artifact) ?? null,
    });
  }

  if (Object.keys(update).length === 0 && inserts.length === 0) {
    const why = dropped.length > 0 ? `（${dropped.join("、")}は採用しませんでした）` : "";
    throw new LlmError(`発言から、直す内容を特定できませんでした${why}`, "invalid");
  }
  return { update, inserts, dropped, ms: Math.round(performance.now() - startedAt) };
}
