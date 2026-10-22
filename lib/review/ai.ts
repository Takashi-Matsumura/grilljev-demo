import { extractJson } from "@/lib/json";
import { chatCompletion } from "@/lib/llm";
import type { Branch, FlowModel } from "@/lib/model/types";
import { loadPrompt } from "@/lib/prompts";
import { flowItems } from "@/lib/render/mermaid";
import type { Finding, FindingCategory, Severity } from "./rules";

/**
 * 業務フローの点検のうち、中身を読まないと言えない指摘（抜けていそうな手順・例外・業務名との食い違い）を
 * gemma に書かせる。server 専用。コードの点検（rules.ts）で指摘済みのものは渡して、重ねないようにする。
 * 出力は信用しない: 形・長さ・手順の番号を確かめ、合わないものは捨てる。
 */

const MAX_STEPS = 60;
const MAX_FINDINGS = 5;
const MAX_TITLE = 60;
const MAX_DETAIL = 220;

const SEVERITIES: Severity[] = ["high", "medium", "low"];
const CATEGORIES: FindingCategory[] = ["flow", "notation", "premise"];

const oneLine = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s === "" || s.length > max ? null : s;
};

export function parseAiFindings(json: unknown, stepCount: number): Finding[] {
  const list = (json as { findings?: unknown } | null)?.findings;
  if (!Array.isArray(list)) return [];
  const out: Finding[] = [];
  for (const [i, raw] of list.entries()) {
    const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const title = oneLine(o.title, MAX_TITLE);
    const detail = oneLine(o.detail, MAX_DETAIL);
    if (!title || !detail) continue;
    const severity = SEVERITIES.includes(o.severity as Severity) ? (o.severity as Severity) : "medium";
    const category = CATEGORIES.includes(o.category as FindingCategory) ? (o.category as FindingCategory) : "flow";
    const steps = Array.isArray(o.steps)
      ? [...new Set(o.steps.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= stepCount))]
      : [];
    out.push({ id: `ai:${i}`, severity, category, title, detail, steps, source: "ai" });
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

/**
 * 業務名だけから想像される流れ。図と一緒に渡すと、gemma は図に引きずられて業務名を読み違える
 * （「請求書発行」を、図のとおり「受け取る業務」と書いた。実測）ので、図を見せずに別に聞く。
 * 書けなければ空（食い違いの点検だけが効かなくなる）
 */
async function expectFromTitle(title: string): Promise<string> {
  if (!title.trim()) return "";
  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: await loadPrompt("review-title") },
        { role: "user", content: title },
      ],
      { temperature: 0, maxTokens: 120, totalTimeoutMs: 30_000 },
    );
    return oneLine((extractJson(raw) as { expected?: unknown } | null)?.expected, 120) ?? "";
  } catch {
    return "";
  }
}

/** AI の点検の結果。summary は AI が図をどう読んだか（チームの意図と見比べられるよう、画面にも出す） */
export type AiReview = { findings: Finding[]; summary: string | null; expected: string | null };

export async function reviewWithAi(model: FlowModel, title: string, already: string[]): Promise<AiReview> {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const flow = flowItems(model);
  const items = flow.flatMap(({ step, branch }, i) => {
    if (!step) return [];
    // 枠のすぐ後の手順（枠の外か、続く別の枠の中）は、枠のすべての場合の合流点。小さなモデルは構造を読み違えるので、明示する
    const prev = flow[i - 1];
    const merge =
      prev?.branch && prev.branch.groupId !== branch?.groupId ? mergeNote(model, prev.branch.groupId) : undefined;
    return [{ step, branch, merge }];
  });
  const name = title || model.scope.title;
  // 業務名だけの問いは、点検の本体と並べて投げる（llama-server は 2 つまで同時に処理できる）
  const expectedPromise = expectFromTitle(name);
  const input = {
    title: name,
    purpose: model.scope.purpose,
    trigger: model.scope.trigger,
    frequency: model.scope.frequency,
    actors: [...model.actors]
      .sort((a, b) => a.lane - b.lane)
      .map((a) => ({
        name: a.name,
        kind: a.kind,
        ...(a.role ? { role: a.role === "trigger" ? "起点" : "終点" } : {}),
        ...(a.members?.length ? { members: a.members } : {}),
      })),
    steps: items.slice(0, MAX_STEPS).map(({ step: s, branch, merge }, i) => ({
      no: i + 1,
      from: nameOf(s.from),
      to: nameOf(s.to),
      label: s.label,
      kind: s.kind,
      ...(s.artifact ? { artifact: s.artifact } : {}),
      ...(s.assignee ? { assignee: s.assignee } : {}),
      ...(branch ? { when: whenNote(branch) } : {}),
      ...(merge ? { merge } : {}),
    })),
    already,
  };
  const system = await loadPrompt("review");
  const raw = await chatCompletion(
    [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(input) },
    ],
    // 思考は止める。許すと、短い図でも 3 分を超えた（実測）。観点はプロンプトで順に示している
    { temperature: 0.3, maxTokens: 1_800, totalTimeoutMs: 120_000 },
  );
  const json = extractJson(raw);
  const findings = dropRepeats(parseAiFindings(json, Math.min(items.length, MAX_STEPS)), already);
  const expected = await expectedPromise;
  const summary = oneLine((json as { summary?: unknown } | null)?.summary, 160);
  const mismatch = summary ? await directionMismatch(expected, summary) : null;
  return { findings: mismatch ? [mismatch, ...findings] : findings, summary, expected: expected || null };
}

/**
 * コードの点検で指摘済みの話題を、言い方を変えて重ねてくるものを落とす。
 * プロンプトで「同じ趣旨は出さない」と言っても、差し戻しの後の流れは毎回重ねてきた（実測）
 */
const REPEATS: { already: RegExp; ai: RegExp }[] = [
  { already: /差し戻した後/, ai: /差し?戻|再送|再提出|修正依頼/ },
  { already: /条件が、動作の名前/, ai: /条件.*(表現|書き方|名前)/ },
  { already: /「依頼（返事を待つ）」/, ai: /(同期|非同期|矢印|返事を待)/ },
];
function dropRepeats(findings: Finding[], already: string[]): Finding[] {
  const topics = REPEATS.filter((r) => already.some((a) => r.already.test(a)));
  return findings.filter((f) => !topics.some((r) => r.ai.test(f.title)));
}

/**
 * 業務名から想像される流れと、図の要約とで、物の流れる向きが逆なら、その指摘。
 * 点検の本体に見比べまでさせると取り違える（両方正しく書けているのに「同じ」と答えた。実測）ので、
 * 2 つの文だけを渡して別に聞く。指摘の文は、gemma の書いた 2 つの文からコードで組み立てる
 */
async function directionMismatch(expected: string, actual: string): Promise<Finding | null> {
  if (!expected) return null;
  try {
    const raw = await chatCompletion(
      [
        { role: "system", content: await loadPrompt("review-direction") },
        { role: "user", content: JSON.stringify({ expected, actual }) },
      ],
      { temperature: 0, maxTokens: 40, totalTimeoutMs: 30_000 },
    );
    if ((extractJson(raw) as { same_direction?: unknown } | null)?.same_direction !== false) return null;
  } catch {
    return null;
  }
  return {
    id: "ai:direction",
    severity: "high",
    category: "premise",
    title: "業務名と、図の流れの向きが食い違っているようです",
    detail: `業務名からは「${expected}」と読めますが、図は「${actual}」になっています。業務名を直すか、流れの向きを直すかを確かめてください。`,
    steps: [],
    source: "ai",
  };
}

/** 枠の中の手順に添える条件。くり返し・条件付きは「当てはまらなければ飛ばす」まで書く（飛ばした先が無いと読まれた。実測） */
function whenNote(b: Branch): string {
  const c = `［${b.condition}］`;
  if (b.kind === "loop") return `${c}の間くり返す（当てはまらなければ一度も行わない）`;
  if (b.kind === "opt") return `${c}のときだけ行う（当てはまらなければ飛ばす）`;
  return `${c}の場合`;
}

/**
 * 枠のすぐ後の手順に添える、合流の説明。枠の種類で言い方を変える
 * （opt に「どの場合も合流」と書くと、条件に当てはまるときだけ続くと読まれた。実測）
 */
function mergeNote(model: FlowModel, groupId: string): string {
  const arms = model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
  const conds = arms.map((b) => `［${b.condition}］`).join("・");
  if (arms[0]?.kind === "opt") return `${conds}に当てはまっても当てはまらなくても、この手順を行う`;
  if (arms[0]?.kind === "loop") {
    return `${conds}の間のくり返しを終えたら、この手順を行う。当てはまらなければ、くり返しは一度も行わずにすぐこの手順へ進む`;
  }
  return `${conds}のどの場合も、この手順へ合流する`;
}
