import { isFlowModel } from "@/lib/model/guard";
import { generateNarration } from "@/lib/preview/narrate";
import { flowText } from "@/lib/summary/flow-text";
import { buildSummaryMarkdown } from "@/lib/summary/markdown";
import { generateProse } from "@/lib/summary/generate";
import { dutiesReadiness } from "@/lib/summary/readiness";

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
  // 概要・改善候補と、業務の流れの文（フローの再生と同じ言い回し）を同時に頼む。どちらも届かなければコードの文で作る
  const [{ prose, error }, narration] = await Promise.all([
    generateProse(model),
    generateNarration(model, model.scope.title).then(
      (n) => ({ n, error: null }),
      (e: unknown) => ({ n: null, error: e instanceof Error ? e.message : "生成に失敗しました" }),
    ),
  ]);
  const markdown = buildSummaryMarkdown(model, prose, {
    generatedAt: new Date().toLocaleString("ja-JP", { hour12: false }),
    warnings: dutiesReadiness(model).warnings,
    flow: flowText(model, narration.n),
    flowByAi: narration.n !== null && Object.keys(narration.n).length > 0,
  });
  return Response.json({ markdown, proseError: error ?? narration.error });
}
