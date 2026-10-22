import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";
import { generateNarration } from "@/lib/preview/narrate";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TITLE = 200;

/** フローのプレビューの字幕を、gemma に自然な文へ言い換えさせる。届かなくても、再生はコードの字幕で続く */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: { model?: unknown; title?: unknown } | null = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const model = body?.model;
  if (!isFlowModel(model)) return Response.json({ error: "図の形式が正しくありません" }, { status: 400 });
  const title = typeof body?.title === "string" ? body.title.slice(0, MAX_TITLE) : "";
  try {
    return Response.json({ narration: await generateNarration(model, title) });
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
