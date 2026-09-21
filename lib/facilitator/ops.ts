import type { FlowModel, ModelOp } from "@/lib/model/types";
import type { Candidate } from "./pick";

/**
 * 選ばれた問いを、モデルの変更（ops）にする。純関数。
 *
 * - 既存の未解決の論点を言い換えた問いなら、その論点を「質問済み」にして文言と推奨回答を持たせる
 * - 新しい問いなら、質問済みの論点として追加する（id は適用時に採番し直される）
 */
export function buildAskOps(model: FlowModel, c: Candidate): ModelOp[] {
  const prompt = { text: c.text, suggestedAnswer: c.suggested };
  if (c.issueId && model.issues.some((i) => i.id === c.issueId && i.status === "open")) {
    return [{ op: "issue.ask", id: c.issueId, prompt }];
  }
  return [
    {
      op: "issue.add",
      issue: {
        id: "I0", // 仮。適用時に最新のモデルで採番し直す
        question: c.text,
        kind: c.kind,
        relatedStepIds: [],
        status: "asked",
        prompt,
        ignored: 0,
      },
    },
  ];
}
