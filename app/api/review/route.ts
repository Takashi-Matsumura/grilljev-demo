import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";
import { reviewWithAi } from "@/lib/review/ai";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 200;
const MAX_ALREADY = 30;

/** 業務フローの点検のうち、AI に任せる指摘。コードの点検（lib/review/rules.ts）は画面ですぐ出す */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: { model?: unknown; title?: unknown; already?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const model = body?.model;
  if (!isFlowModel(model)) return Response.json({ error: "図の形式が正しくありません" }, { status: 400 });
  const title = typeof body?.title === "string" ? body.title.slice(0, MAX_TITLE) : "";
  const already = Array.isArray(body?.already)
    ? body.already.filter((a): a is string => typeof a === "string" && a.length <= 200).slice(0, MAX_ALREADY)
    : [];
  try {
    return Response.json(await reviewWithAi(model, title, already));
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
