import { extractJson } from "@/lib/json";
import { chatCompletion, LlmError } from "@/lib/llm";
import { loadPrompt } from "@/lib/prompts";
import type { FlowModel, IssueKind } from "@/lib/model/types";
import type { Candidate } from "./pick";
import { purposeMissing } from "./purpose";

/**
 * gemma に「問いの候補」を書かせる。server 専用。
 * 出力は信用しない: 形・長さ・種別を検証し、既出・保留済みの問いは捨てる。
 */

const KINDS: IssueKind[] = ["purpose", "who", "when", "criteria", "exception", "tool", "handoff"];
const MAX_TEXT = 100;
const MAX_CANDIDATES = 3;
const MAX_STEPS = 20;
const RECENT = 6;

/** 存在意義（ops-grill の第一原理）。gemma が書き忘れても、これは必ず問えるようにする。 */
export const PURPOSE_QUESTION: Omit<Candidate, "id"> = {
  kind: "purpose",
  text: "この業務は、誰のために、どんな価値を出していますか？",
  suggested: "",
  issueId: null,
};

const clean = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" || s.length > max ? null : s;
};

export async function generateCandidates(
  model: FlowModel,
  recent: string[],
): Promise<{ candidates: Candidate[]; ms: number }> {
  const startedAt = performance.now();
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;

  const openIssues = model.issues.filter((i) => i.status === "open");
  const askedBefore = model.issues.filter((i) => i.prompt).map((i) => i.prompt!.text);
  const parked = model.issues.filter((i) => i.status === "parked").map((i) => i.prompt?.text ?? i.question);

  const input = {
    scope: { title: model.scope.title, purpose: model.scope.purpose },
    purpose_missing: purposeMissing(model),
    actors: model.actors.map((a) => a.name),
    steps: model.steps
      .filter((s) => s.status !== "retracted")
      .sort((a, b) => a.order - b.order)
      .slice(-MAX_STEPS)
      .map((s) => `${nameOf(s.from)}→${nameOf(s.to)}: ${s.label}${s.status === "provisional" ? " ?" : ""}`),
    open_issues: openIssues.map((i) => ({ id: i.id, kind: i.kind, question: i.question })),
    parked,
    asked_before: askedBefore,
    recent_utterances: recent.slice(-RECENT),
  };

  const raw = await chatCompletion(
    [
      { role: "system", content: await loadPrompt("facilitator") },
      { role: "user", content: JSON.stringify(input) },
    ],
    // 3 候補 × 約 80 トークン。多少の余裕を見る。多様性のため温度は高め
    { maxTokens: 700, temperature: 0.5, totalTimeoutMs: 30_000 },
  );

  const json = extractJson(raw) as { candidates?: unknown } | null;
  if (!json || !Array.isArray(json.candidates)) {
    throw new LlmError(`問いの候補を取り出せませんでした: ${raw.slice(0, 120)}`, "invalid");
  }

  const banned = new Set([...askedBefore, ...parked]);
  const openIds = new Set(openIssues.map((i) => i.id));
  const seenText = new Set<string>();
  const usedIssue = new Set<string>();
  const out: Omit<Candidate, "id">[] = [];

  for (const item of json.candidates) {
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const text = clean(c.text, MAX_TEXT);
    if (!text || banned.has(text) || seenText.has(text)) continue;
    if (!(KINDS as unknown[]).includes(c.kind)) continue;
    const issueId =
      typeof c.issue_id === "string" && openIds.has(c.issue_id) && !usedIssue.has(c.issue_id)
        ? c.issue_id
        : null;
    if (issueId) usedIssue.add(issueId);
    seenText.add(text);
    out.push({
      kind: c.kind as IssueKind,
      text,
      // 推奨回答は採用された 1 問にだけ、あとで別に作る（3 候補分を書かせると生成が倍かかる）
      suggested: "",
      issueId,
    });
  }

  // 存在意義が未確定なら、目的を問う候補を必ず先頭に置く
  if (purposeMissing(model) && !out.some((c) => c.kind === "purpose")) {
    out.unshift(PURPOSE_QUESTION);
  }
  if (out.length === 0) throw new LlmError("使える問いの候補がありませんでした", "invalid");

  return {
    candidates: out.slice(0, MAX_CANDIDATES).map((c, i) => ({ ...c, id: `c${i + 1}` })),
    ms: Math.round(performance.now() - startedAt),
  };
}

/**
 * 採用された 1 問に、推奨回答（会話から推測できる範囲の仮の答え）を添える（grill-me の規律）。
 * 失敗しても問い自体は出せるので、例外は上げず空文字を返す。
 */
export async function suggestAnswer(
  model: FlowModel,
  recent: string[],
  question: string,
): Promise<{ suggested: string; ms: number }> {
  const startedAt = performance.now();
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: await loadPrompt("suggest-answer") },
        {
          role: "user",
          content: JSON.stringify({
            question,
            scope: { title: model.scope.title, purpose: model.scope.purpose },
            steps: model.steps
              .filter((s) => s.status !== "retracted")
              .sort((a, b) => a.order - b.order)
              .slice(-12)
              .map((s) => `${nameOf(s.from)}→${nameOf(s.to)}: ${s.label}${s.status === "provisional" ? " ?" : ""}`),
            recent_utterances: recent.slice(-4),
          }),
        },
      ],
      { maxTokens: 120, temperature: 0.2, totalTimeoutMs: 15_000 },
    );
    const json = extractJson(raw) as { suggested?: unknown } | null;
    return { suggested: clean(json?.suggested, 80) ?? "", ms: Math.round(performance.now() - startedAt) };
  } catch {
    return { suggested: "", ms: Math.round(performance.now() - startedAt) };
  }
}
