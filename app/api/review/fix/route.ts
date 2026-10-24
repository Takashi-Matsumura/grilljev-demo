import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";
import { generateAiFix } from "@/lib/review/fix-ai";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_FINDING_ID = 100;

/**
 * 点検の指摘の「直す案」のうち、言い換えを AI に書かせるもの（lib/review/fix.ts の fixKindOf が "ai"）。
 * 返すのは案（ops と「前 → 後」）だけで、図は変えない。案にできなければ fix は null
 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: { model?: unknown; title?: unknown; findingId?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const model = body?.model;
  if (!isFlowModel(model)) return Response.json({ error: "図の形式が正しくありません" }, { status: 400 });
  const findingId = body?.findingId;
  if (typeof findingId !== "string" || findingId.length > MAX_FINDING_ID) {
    return Response.json({ error: "指摘の指定が正しくありません" }, { status: 400 });
  }
  const title = typeof body?.title === "string" ? body.title.slice(0, MAX_TITLE) : "";
  try {
    return Response.json({ fix: await generateAiFix(model, title, findingId) });
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
