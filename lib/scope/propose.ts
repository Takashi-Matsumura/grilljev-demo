import { extractJson } from "@/lib/json";
import { chatCompletion, LlmError } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import type { FlowModel } from "@/lib/model/types";
import type { ShiftRelation } from "./drift";
import type { TitleCandidate } from "./pick";

/**
 * gemma に「新しい業務名の候補」を書かせる。server 専用。
 * 出力は信用しない: 形・長さを検証し、現在の業務名と同じもの・重複は捨てる。
 */

const MAX_TITLE = 30;
const MAX_REASON = 60;
const MAX_CANDIDATES = 3;

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").replace(/^[「『"']+|[」』"'。]+$/g, "").trim();
  return s === "" || s.length > max ? null : s;
};

export async function generateTitleCandidates(
  model: FlowModel,
  recent: string[],
  relation: ShiftRelation,
): Promise<{ candidates: TitleCandidate[]; ms: number }> {
  const startedAt = performance.now();
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;

  const input = {
    current_scope: { title: model.scope.title, purpose: model.scope.purpose },
    relation,
    recent_utterances: recent.slice(-4),
    steps: model.steps
      .filter((s) => s.status !== "retracted")
      .sort((a, b) => a.order - b.order)
      .slice(-10)
      .map((s) => `${nameOf(s.from)}→${nameOf(s.to)}: ${s.label}`),
  };

  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt("scope-shift") },
      { role: "user", content: JSON.stringify(input) },
    ],
    { maxTokens: 350, temperature: 0.4, totalTimeoutMs: 25_000 },
  );

  const json = extractJson(raw) as { candidates?: unknown } | null;
  if (!json || !Array.isArray(json.candidates)) {
    throw new LlmError(`業務名の候補を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");
  }

  const seen = new Set<string>([model.scope.title.trim()]);
  const out: Omit<TitleCandidate, "id">[] = [];
  for (const item of json.candidates) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const title = clean(c.title, MAX_TITLE);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push({ title, reason: clean(c.reason, MAX_REASON) ?? "" });
  }
  if (out.length === 0) throw new LlmError("使える業務名の候補がありませんでした", "invalid");

  return {
    candidates: out.slice(0, MAX_CANDIDATES).map((c, i) => ({ ...c, id: `c${i + 1}` })),
    ms: Math.round(performance.now() - startedAt),
  };
}
