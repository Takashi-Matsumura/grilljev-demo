import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { FlowModel } from "@/lib/model/types";
import { loadPrompt } from "@/lib/prompts";
import { flowItems } from "@/lib/render/mermaid";
import { aiFixTarget, buildAiFix, type Fix } from "./fix";

/**
 * 点検の指摘の「直す案」のうち、言い換え（分岐の条件・短いステップ名）を gemma に書かせる。server 専用。
 * gemma に書かせるのは言い換えの文だけ。どの条件・どの手順を直すかはコードが決め（aiFixTarget）、
 * 出力はコードで確かめてから案にする（buildAiFix）。案にできなければ null
 */
export async function generateAiFix(model: FlowModel, title: string, findingId: string): Promise<Fix | null> {
  const target = aiFixTarget(model, findingId);
  if (!target) return null;
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const items = flowItems(model).flatMap(({ step, branch }) => (step ? [{ step, branch }] : []));
  const line = (i: number) => {
    const it = items[i];
    return it ? `${nameOf(it.step.from)}→${nameOf(it.step.to)}: ${it.step.label}` : undefined;
  };

  const input =
    target.kind === "condition"
      ? {
          title: title || model.scope.title,
          kind: target.frame[0].kind,
          // 直さない場合も、言い方を揃える手がかりに渡す
          arms: target.frame.map((arm) => ({
            id: arm.id,
            condition: arm.condition,
            rewrite: target.arms.includes(arm),
            steps: items
              .filter((it) => it.step.branchId === arm.id)
              .map(({ step }) => `${nameOf(step.from)}→${nameOf(step.to)}: ${step.label}`),
          })),
        }
      : {
          title: title || model.scope.title,
          steps: target.steps.map((s) => {
            const i = items.findIndex((it) => it.step.id === s.id);
            const branch = items[i]?.branch;
            return {
              id: s.id,
              from: nameOf(s.from),
              to: nameOf(s.to),
              label: s.label,
              kind: s.kind,
              ...(s.artifact ? { artifact: s.artifact } : {}),
              ...(branch ? { when: branch.condition } : {}),
              ...(line(i - 1) ? { before: line(i - 1) } : {}),
              ...(line(i + 1) ? { after: line(i + 1) } : {}),
            };
          }),
        };

  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt(target.kind === "condition" ? "review-fix-condition" : "review-fix-label") },
      { role: "user", content: JSON.stringify(input) },
    ],
    { temperature: 0.2, maxTokens: 600, totalTimeoutMs: 60_000 },
  );
  return buildAiFix(model, target, extractJson(raw));
}
