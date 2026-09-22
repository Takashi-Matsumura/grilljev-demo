import { generateCandidates, suggestAnswer } from "@/lib/facilitator/candidates";
import { purposeMissing } from "@/lib/facilitator/purpose";
import {
  buildPickQuestions,
  buildPickState,
  decidePick,
  type Candidate,
  type PickDecision,
} from "@/lib/facilitator/pick";
import { JevError, postJev, type JevExchange } from "@/lib/jev";
import { LlmError } from "@/lib/llm";
import { isFlowModel } from "@/lib/model/guard";

export const dynamic = "force-dynamic";

export type FacilitateResponse = {
  status: PickDecision["status"];
  chosen?: Candidate;
  candidates: Candidate[];
  summary: string;
  /** 誰が決めたか。目的が未確定のときは Jev を介さず、コードで決める */
  decidedBy: "first-principle" | "jev";
  gemmaMs: number;
  /** 採用した 1 問の推奨回答を作るのにかかった時間 */
  suggestMs?: number;
  decision?: PickDecision;
  exchange?: JevExchange<object>;
};

export async function POST(request: Request) {
  let body: { model?: unknown; recent?: unknown; force?: unknown; silenceSec?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "JSON を解析できません" }, { status: 400 });
  }
  if (!isFlowModel(body.model)) {
    return Response.json({ error: "model の形式が正しくありません" }, { status: 400 });
  }
  const model = body.model;
  const force = body.force === true;
  // 最後の発言からの秒数（議論が続いているかの判断材料）。不明・不正なら null
  const silenceSec =
    typeof body.silenceSec === "number" && Number.isFinite(body.silenceSec) && body.silenceSec >= 0
      ? Math.min(body.silenceSec, 3_600)
      : null;
  const recent = Array.isArray(body.recent)
    ? body.recent.filter((r): r is string => typeof r === "string" && r.length <= 1_000).slice(-6)
    : [];

  try {
    // 1. gemma が候補を書く（ローカル）
    const { candidates, ms: gemmaMs } = await generateCandidates(model, recent);

    // 2. 存在意義が未確定なら、それを問うのが最優先（ops-grill の第一原理）。
    //    ここは判断ではなく規律なので、Jev を介さずコードで決める。
    if (purposeMissing(model)) {
      const picked = candidates.find((c) => c.kind === "purpose") ?? candidates[0];
      const s = await suggestAnswer(model, recent, picked.text);
      const chosen = { ...picked, suggested: s.suggested };
      const res: FacilitateResponse = {
        status: "ask",
        chosen,
        candidates,
        suggestMs: s.ms,
        decidedBy: "first-principle",
        gemmaMs,
        summary: "業務の目的が未確定のため、まず存在意義を問います",
      };
      return Response.json(res);
    }

    // 3. Jev が「いま出すべき 1 問」を選ぶ（根拠なし・回答済みは捨てる。決め手に欠けるなら黙る）
    const exchange = await postJev(
      buildPickState(model, recent, candidates, silenceSec),
      buildPickQuestions(candidates),
    );
    const decision = decidePick(exchange.response.answers, candidates, { force });
    // 採用した 1 問にだけ推奨回答を添える
    const s = decision.chosen ? await suggestAnswer(model, recent, decision.chosen.text) : null;
    const res: FacilitateResponse = {
      status: decision.status,
      chosen: decision.chosen && s ? { ...decision.chosen, suggested: s.suggested } : decision.chosen,
      suggestMs: s?.ms,
      candidates,
      decidedBy: "jev",
      gemmaMs,
      summary: decision.summary,
      decision,
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
