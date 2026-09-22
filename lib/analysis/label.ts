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

export type ExtractedActor = { name: string; kind: ActorKind };
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

function toActor(value: unknown): ExtractedActor | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const name = cleanText(v.name, MAX_NAME_CHARS)?.replace(/(さん|様|氏)$/, "") ?? null;
  if (!name) return null;
  const kind = (ACTOR_KINDS as unknown[]).includes(v.kind) ? (v.kind as ActorKind) : "role";
  return { name, kind };
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
    from: input.need.includes("from") ? toActor(json.from) : null,
    to: input.need.includes("to") ? toActor(json.to) : null,
    ms: Math.round(performance.now() - startedAt),
  };
}
