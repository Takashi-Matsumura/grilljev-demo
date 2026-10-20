import { extractJson } from "@/lib/json";
import { chatCompletion, LlmError } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import { MAX_ACTOR_CHARS, SEED_ACTOR_KINDS, type SeedActor } from "@/lib/store/session-types";

/**
 * 業務名から、抜けていそうな登場人物の候補を gemma に書かせる。server 専用。
 * 候補はたたき台で、採用は人が決める。出力は信用しない: 形・長さ・種別を検証し、既出は捨てる。
 */

export type ActorCandidate = { name: string; kind: SeedActor["kind"]; why: string };

const MAX_CANDIDATES = 6;
const MAX_WHY = 40;

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" || s.length > max ? null : s;
};

/** 「経理」と「経理部」のような言い換えを既出とみなすための比較用の形 */
const norm = (s: string) => s.replace(/\s/g, "").replace(/(部|課|室|係|チーム)$/, "");

export async function suggestActors(
  title: string,
  known: string[],
): Promise<{ candidates: ActorCandidate[]; ms: number }> {
  const startedAt = performance.now();
  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt("suggest-actors") },
      { role: "user", content: JSON.stringify({ title, known }) },
    ],
    { maxTokens: 600, temperature: 0.3, totalTimeoutMs: 30_000 },
  );

  const json = extractJson(raw) as { candidates?: unknown } | null;
  if (!json || !Array.isArray(json.candidates)) {
    throw new LlmError(`候補を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");
  }

  const seen = new Set(known.map(norm));
  const out: ActorCandidate[] = [];
  for (const item of json.candidates) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const name = clean(c.name, MAX_ACTOR_CHARS);
    const kind = SEED_ACTOR_KINDS.find((k) => k === c.kind);
    if (!name || !kind || seen.has(norm(name))) continue;
    seen.add(norm(name));
    out.push({ name, kind, why: clean(c.why, MAX_WHY) ?? "" });
  }
  return { candidates: out.slice(0, MAX_CANDIDATES), ms: Math.round(performance.now() - startedAt) };
}
