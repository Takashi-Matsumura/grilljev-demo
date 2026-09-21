import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { FlowModel } from "@/lib/model/types";
import { loadPrompt } from "@/lib/prompts";
import { visibleSteps } from "@/lib/render/mermaid";
import { parseProse, type SummaryProse } from "./prose";

/**
 * gemma に「概要」と「改善候補」だけを書かせる。server 専用。
 * 失敗（接続不可・JSON 不正・形の違反）はすべて「書けなかった」として空の文章を返す。
 * 文書の事実の部分（表・図）は gemma に依存しないので、gemma が落ちていても文書は作れる。
 */
export async function generateProse(model: FlowModel): Promise<{ prose: SummaryProse; error: string | null }> {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const input = {
    title: model.scope.title,
    purpose: model.scope.purpose,
    actors: model.actors.map((a) => a.name),
    steps: visibleSteps(model)
      .slice(0, 60)
      .map((s) => ({
        step: `${nameOf(s.from)} → ${nameOf(s.to)}: ${s.label}`,
        flags: Object.keys(s.flags),
        provisional: s.status === "provisional",
      })),
    open_issues: model.issues.filter((i) => i.status !== "answered").slice(0, 10).map((i) => i.question),
  };
  try {
    const system = await loadPrompt("summary");
    const raw = await chatCompletion(
      [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(input) },
      ],
      { temperature: 0.2, maxTokens: 500, totalTimeoutMs: 60_000 },
    );
    return { prose: parseProse(extractJson(raw)), error: null };
  } catch (e) {
    return { prose: { overview: null, improvements: [] }, error: e instanceof Error ? e.message : "生成に失敗しました" };
  }
}
