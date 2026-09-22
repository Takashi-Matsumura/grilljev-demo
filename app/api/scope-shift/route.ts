import { JevError, postJev, type JevExchange } from "@/lib/jev";
import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";
import type { ShiftRelation } from "@/lib/scope/drift";
import {
  buildShiftQuestions,
  buildShiftState,
  decideShift,
  type ShiftDecision,
  type TitleCandidate,
} from "@/lib/scope/pick";
import { generateTitleCandidates } from "@/lib/scope/propose";

export const dynamic = "force-dynamic";

export type ScopeShiftResponse = {
  status: ShiftDecision["status"];
  chosen?: TitleCandidate;
  candidates: TitleCandidate[];
  summary: string;
  moved: number | null;
  gemmaMs: number;
  exchange: JevExchange<object>;
};

const RELATIONS: readonly string[] = ["sibling", "parent", "child"];

export async function POST(request: Request) {
  let body: { model?: unknown; recent?: unknown; relation?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "JSON を解析できません" }, { status: 400 });
  }
  if (!isFlowModel(body.model)) {
    return Response.json({ error: "model の形式が正しくありません" }, { status: 400 });
  }
  if (typeof body.relation !== "string" || !RELATIONS.includes(body.relation)) {
    return Response.json({ error: "relation が正しくありません" }, { status: 400 });
  }
  const model = body.model;
  const relation = body.relation as ShiftRelation;
  const recent = Array.isArray(body.recent)
    ? body.recent.filter((r): r is string => typeof r === "string" && r.length <= 1_000).slice(-4)
    : [];

  try {
    // 1. gemma が新しい業務名の候補を書く（ローカル）
    const { candidates, ms: gemmaMs } = await generateTitleCandidates(model, recent, relation);
    // 2. Jev が「いまの会話は何の業務の話か」を選ぶ。「現状のまま」も選べる（誤検知を止める）
    const exchange = await postJev(
      buildShiftState(model, recent, relation, candidates),
      buildShiftQuestions(model, candidates),
    );
    const decision = decideShift(exchange.response.answers, candidates);
    const res: ScopeShiftResponse = {
      status: decision.status,
      chosen: decision.chosen,
      candidates,
      summary: decision.summary,
      moved: decision.moved,
      gemmaMs,
      exchange,
    };
    return Response.json(res);
  } catch (e) {
    if (e instanceof JevError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: e.status });
    }
    if (e instanceof LlmError) {
      return Response.json(
        { error: e.message, kind: e.kind },
        { status: e.kind === "invalid" ? 422 : 502 },
      );
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
