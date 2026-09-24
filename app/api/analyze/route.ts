import { interpret } from "@/lib/analysis/interpret";
import { buildUtteranceQuestions, buildUtteranceState } from "@/lib/analysis/questions";
import { JevError, postJev } from "@/lib/jev";
import { isFlowModel } from "@/lib/model/guard";
import { MAX_CHECKS_PER_REQUEST, type PendingCheck } from "@/lib/analysis/verify";

export const dynamic = "force-dynamic";

const MAX_UTTERANCE_CHARS = 1_000;

type Body = {
  utterance?: unknown;
  utteranceId?: unknown;
  model?: unknown;
  recent?: unknown;
  verify?: unknown;
};

const str = (v: unknown, max: number): v is string =>
  typeof v === "string" && v !== "" && v.length <= max;

/** 検証待ちも信頼できないクライアント入力。形と長さを確かめ、上限で切る。 */
function parseChecks(value: unknown): PendingCheck[] {
  if (!Array.isArray(value)) return [];
  const out: PendingCheck[] = [];
  for (const v of value) {
    if (typeof v !== "object" || v === null) continue;
    const c = v as Record<string, unknown>;
    if (c.kind === "label" && str(c.stepId, 20) && str(c.label, 100) && str(c.source, 300)) {
      const attempts = typeof c.attempts === "number" && c.attempts >= 1 && c.attempts <= 5 ? Math.floor(c.attempts) : 1;
      out.push({ kind: "label", stepId: c.stepId, label: c.label, source: c.source, attempts });
    } else if (c.kind === "actor" && str(c.actorId, 20) && str(c.name, 60)) {
      out.push({ kind: "actor", actorId: c.actorId, name: c.name });
    }
  }
  return out.slice(-MAX_CHECKS_PER_REQUEST);
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "JSON を解析できません" }, { status: 400 });
  }

  const utterance = typeof body.utterance === "string" ? body.utterance.trim() : "";
  if (utterance === "") {
    return Response.json({ error: "utterance が空です" }, { status: 400 });
  }
  if (utterance.length > MAX_UTTERANCE_CHARS) {
    return Response.json({ error: "utterance が長すぎます" }, { status: 413 });
  }
  if (!isFlowModel(body.model)) {
    return Response.json({ error: "model の形式が正しくありません" }, { status: 400 });
  }
  const utteranceId = typeof body.utteranceId === "string" ? body.utteranceId : "unknown";
  const recent = Array.isArray(body.recent)
    ? body.recent.filter((r): r is string => typeof r === "string").slice(-3)
    : [];

  const model = body.model;
  const checks = parseChecks(body.verify);
  try {
    const exchange = await postJev(
      buildUtteranceState(model, utterance, recent),
      buildUtteranceQuestions(model, checks),
    );
    const interpretation = interpret(exchange.response.answers, model, {
      utterance,
      utteranceId,
      checks,
    });
    return Response.json({ interpretation, exchange });
  } catch (e) {
    if (e instanceof JevError) {
      return Response.json({ error: e.message, kind: e.kind, debug: e.debug }, { status: e.status });
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "不明なエラー" },
      { status: 500 },
    );
  }
}
