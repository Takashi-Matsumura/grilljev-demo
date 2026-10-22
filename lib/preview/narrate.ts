import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { FlowModel } from "@/lib/model/types";
import { loadPrompt } from "@/lib/prompts";
import { flowItems } from "@/lib/render/mermaid";
import { armContext, type Narration } from "./scenes";

/**
 * プレビューの字幕を、gemma に自然な文へ言い換えさせる。server 専用。
 * 事実（誰から誰へ・何を）は図のモデルにあり、gemma は言い回しだけを書く。
 * 出力は信用しない: 知らない鍵・長すぎる文は捨てる（その場面はコードで作った字幕のまま）。
 */

/** 長い図でも待たせすぎない。これより後ろのステップは、コードで作った字幕で流す */
const MAX_STEPS = 60;
export const MAX_CAPTION_CHARS = 120;

const oneLine = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" || s.length > MAX_CAPTION_CHARS ? null : s;
};

export function parseNarration(json: unknown, stepIds: Set<string>): Narration {
  const j = (typeof json === "object" && json !== null ? json : {}) as Record<string, unknown>;
  const out: Narration = {};
  for (const key of ["intro", "outro"] as const) {
    const s = oneLine(j[key]);
    if (s) out[key] = s;
  }
  const steps = (typeof j.steps === "object" && j.steps !== null ? j.steps : {}) as Record<string, unknown>;
  for (const [id, v] of Object.entries(steps)) {
    const s = oneLine(v);
    if (s && stepIds.has(id)) out[id] = s;
  }
  return out;
}

export async function generateNarration(model: FlowModel, title: string): Promise<Narration> {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const steps = flowItems(model)
    .flatMap(({ step, branch }) => (step ? [{ step, branch }] : []))
    .slice(0, MAX_STEPS);
  const input = {
    title: title || model.scope.title,
    purpose: model.scope.purpose,
    trigger: model.actors.find((a) => a.role === "trigger")?.name ?? null,
    end: model.actors.find((a) => a.role === "end")?.name ?? null,
    steps: steps.map(({ step: s, branch }) => ({
      id: s.id,
      from: nameOf(s.from),
      to: nameOf(s.to),
      label: s.label,
      kind: s.kind,
      ...(s.artifact ? { artifact: s.artifact } : {}),
      ...(s.assignee ? { assignee: s.assignee } : {}),
      ...(branch ? { when: armContext(branch) } : {}),
      ...(s.status === "provisional" ? { provisional: true } : {}),
    })),
  };
  const system = await loadPrompt("narrate");
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ],
    // 1 文あたり 60 トークン前後。思考は止めたまま（字幕に要らない）
    { temperature: 0.3, maxTokens: Math.min(4_000, 300 + 80 * steps.length), totalTimeoutMs: 120_000 },
  );
  return parseNarration(extractJson(raw), new Set(steps.map(({ step }) => step.id)));
}
