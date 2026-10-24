import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";
import type { FixableFinding } from "@/lib/review/fix";
import { generateAiFix } from "@/lib/review/fix-ai";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_FINDING_ID = 100;
const MAX_FINDING_TEXT = 400;
const CATEGORIES = ["flow", "notation", "premise"];

/** 指摘の中身。AI の指摘は図の外（画面）から届くので、形と長さを確かめる。合わなければ null */
function parseFinding(v: unknown): FixableFinding | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  const text = (x: unknown) => typeof x === "string" && x.length <= MAX_FINDING_TEXT;
  if (typeof f.id !== "string" || f.id.length > MAX_FINDING_ID || !text(f.title) || !text(f.detail)) return null;
  if (f.source !== "rule" && f.source !== "ai") return null;
  if (typeof f.category !== "string" || !CATEGORIES.includes(f.category)) return null;
  const steps = Array.isArray(f.steps) ? f.steps.filter((n): n is number => Number.isInteger(n) && n > 0).slice(0, 30) : [];
  return {
    id: f.id,
    source: f.source,
    category: f.category as FixableFinding["category"],
    title: f.title as string,
    detail: f.detail as string,
    steps,
  };
}

/**
 * 点検の指摘の「直す案」のうち、AI に書かせるもの（lib/review/fix.ts の fixKindOf が "ai"）。
 * 返すのは案（ops と「前 → 後」）だけで、図は変えない。案にできなければ fix は null
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: { model?: unknown; title?: unknown; finding?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const model = body?.model;
  if (!isFlowModel(model)) return Response.json({ error: "図の形式が正しくありません" }, { status: 400 });
  const finding = parseFinding(body?.finding);
  if (!finding) return Response.json({ error: "指摘の指定が正しくありません" }, { status: 400 });
  const title = typeof body?.title === "string" ? body.title.slice(0, MAX_TITLE) : "";
  try {
    return Response.json({ fix: await generateAiFix(model, title, finding) });
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
