import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { FlowModel } from "@/lib/model/types";
import { loadPrompt } from "@/lib/prompts";
import type { FlowBlock } from "./flow-text";

/**
 * 業務のまとまり（lib/summary/flow-text.ts の FlowBlock）に、AI で業務の名前を付ける。server 専用。
 * まとまりの切れ目と中の手順はコードが決め、AI は名前だけを書く。出力は信用しない:
 * 数が合わない・長すぎる・形の名前（「分岐」「合流後」など）だけのものは捨て、そのまとまりは形の見出しのまま出す。
 */

export const MAX_PHASE_NAME_CHARS = 20;
/** 名前として使わない、形だけの言い方 */
const STRUCTURAL = /^(開始|分岐|合流|合流後|くり返し|繰り返し|くり返しの後|その後|条件付き|終了)$/;

export function parsePhaseNames(json: unknown, count: number): (string | null)[] {
  const raw = (typeof json === "object" && json !== null ? (json as Record<string, unknown>).names : null) as unknown;
  const list = Array.isArray(raw) ? raw : [];
  const names = Array.from({ length: count }, (_, i) => {
    const v = list[i];
    if (typeof v !== "string") return null;
    const s = v.replace(/\s+/g, " ").trim();
    if (s === "" || [...s].length > MAX_PHASE_NAME_CHARS || STRUCTURAL.test(s)) return null;
    return s;
  });
  // 隣と同じ名前は、見分けが付かないので後ろを捨てる
  return names.map((n, i) => (n !== null && i > 0 && names[i - 1] === n ? null : n));
}

export async function generatePhaseNames(
  model: FlowModel,
  blocks: FlowBlock[],
): Promise<{ names: (string | null)[] | null; error: string | null }> {
  if (blocks.length === 0) return { names: [], error: null };
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const stepById = new Map(model.steps.map((s) => [s.id, s]));
  const input = {
    title: model.scope.title,
    purpose: model.scope.purpose,
    blocks: blocks.map((b) => ({
      kind: b.title,
      steps: b.stepIds.flatMap((id) => {
        const s = stepById.get(id);
        return s ? [`${nameOf(s.from)} → ${nameOf(s.to)}: ${s.label}`] : [];
      }),
    })),
  };
  try {
    const system = await loadPrompt("phase-names");
    const raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) },
      ],
      { temperature: 0.2, maxTokens: Math.min(1_500, 100 + 40 * blocks.length), totalTimeoutMs: 60_000 },
    );
    return { names: parsePhaseNames(extractJson(raw), blocks.length), error: null };
  } catch (e) {
    return { names: null, error: e instanceof Error ? e.message : "生成に失敗しました" };
  }
}
