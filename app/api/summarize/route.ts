import { isFlowModel } from "@/lib/model/guard";
import { buildSummaryMarkdown } from "@/lib/summary/markdown";
import { generateProse } from "@/lib/summary/generate";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 図（FlowModel）から業務分掌ドキュメントを作る。表と図はコード、概要と改善候補だけ gemma。 */
export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const model = (body as { model?: unknown } | null)?.model;
  if (!isFlowModel(model)) return Response.json({ error: "図の形式が正しくありません" }, { status: 400 });
  const { prose, error } = await generateProse(model);
  const markdown = buildSummaryMarkdown(model, prose, {
    generatedAt: new Date().toLocaleString("ja-JP", { hour12: false }),
  });
  return Response.json({ markdown, proseError: error });
}
