import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { FlowModel } from "@/lib/model/types";
import { loadPrompt, type PromptName } from "@/lib/prompts";
import { flowItems } from "@/lib/render/mermaid";
import { aiFixTarget, buildAiFix, declinedOf, type AiFixTarget, type Fix, type FixableFinding } from "./fix";

/**
 * 点検の指摘の「直す案」のうち、AI に書かせるもの（分岐の条件・短いステップ名の言い換え、業務の前提の下書き、
 * 指摘に応える仮の手順）を gemma に頼む。server 専用。
 * どの条件・どの手順・どの欄を直すかはコードが決め（aiFixTarget）、gemma には中身の文だけを書かせる。
 * 出力はコードで確かめてから案にする（buildAiFix）。案にできなければ fix は null で、
 * AI が「手順を足しても応えられない」と答えたときは declined にその理由（無ければ ""）を入れる
 */

export type AiFixResult = { fix: Fix | null; declined?: string };

const PROMPT: Record<AiFixTarget["kind"], PromptName> = {
  condition: "review-fix-condition",
  label: "review-fix-label",
  premise: "review-fix-premise",
  steps: "review-fix-steps",
};

/** 図全体を渡すとき（前提の下書き・足す手順）の手順の上限 */
const MAX_STEPS = 60;

export async function generateAiFix(model: FlowModel, title: string, finding: FixableFinding): Promise<AiFixResult> {
  const target = aiFixTarget(model, finding);
  if (!target) return { fix: null };
  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt(PROMPT[target.kind]) },
      { role: "user", content: JSON.stringify(inputFor(model, title || model.scope.title, target)) },
    ],
    { temperature: 0.2, maxTokens: 600, totalTimeoutMs: 60_000 },
  );
  const json = extractJson(raw);
  const fix = buildAiFix(model, target, json);
  if (fix) return { fix };
  const declined = declinedOf(target, json);
  return declined === null ? { fix: null } : { fix: null, declined };
}

function inputFor(model: FlowModel, title: string, target: AiFixTarget): unknown {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const items = flowItems(model).flatMap(({ step, branch }) => (step ? [{ step, branch }] : []));
  const line = (i: number) => {
    const it = items[i];
    return it ? `${nameOf(it.step.from)}→${nameOf(it.step.to)}: ${it.step.label}` : undefined;
  };

  if (target.kind === "condition") {
    return {
      title,
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
    };
  }
  if (target.kind === "label") {
    return {
      title,
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
  }

  // 前提の下書き・足す手順は、図全体を読ませる
  const whole = {
    title,
    actors: [...model.actors]
      .sort((a, b) => a.lane - b.lane)
      .map((a) => ({
        name: a.name,
        kind: a.kind,
        ...(a.role ? { role: a.role === "trigger" ? "起点" : "終点" } : {}),
        ...(a.product ? { product: a.product } : {}),
      })),
    steps: items.slice(0, MAX_STEPS).map(({ step: s, branch }, i) => ({
      no: i + 1,
      from: nameOf(s.from),
      to: nameOf(s.to),
      label: s.label,
      kind: s.kind,
      ...(s.artifact ? { artifact: s.artifact } : {}),
      ...(branch ? { when: `［${branch.condition}］${branch.kind === "loop" ? "の間くり返す" : "の場合"}` } : {}),
      ...(s.status === "provisional" ? { provisional: true } : {}),
    })),
  };
  if (target.kind === "premise") return { ...whole, fields: target.fields };
  return { ...whole, finding: target.finding };
}
