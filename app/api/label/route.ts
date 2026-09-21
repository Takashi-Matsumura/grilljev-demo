import { extractActors, labelStep } from "@/lib/analysis/label";
import { LlmError } from "@/lib/llm";

export const dynamic = "force-dynamic";

const MAX_TEXT = 1_000;
const MAX_NAME = 60;

const isStr = (v: unknown, max: number): v is string =>
  typeof v === "string" && v.trim() !== "" && v.length <= max;

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "JSON を解析できません" }, { status: 400 });
  }

  try {
    if (body.mode === "step") {
      const prev = body.previousBranch as { condition?: unknown; kind?: unknown } | null | undefined;
      if (
        !isStr(body.utterance, MAX_TEXT) ||
        !isStr(body.from, MAX_NAME) ||
        !isStr(body.to, MAX_NAME) ||
        !isStr(body.messageKind, 20)
      ) {
        return Response.json({ error: "入力の形式が正しくありません" }, { status: 400 });
      }
      const result = await labelStep({
        utterance: body.utterance,
        from: body.from,
        to: body.to,
        messageKind: body.messageKind,
        branchHint: body.branchHint === true,
        avoid: isStr(body.avoid, 100) ? body.avoid : undefined,
        previousBranch:
          prev && isStr(prev.condition, MAX_NAME) && isStr(prev.kind, 10)
            ? { condition: prev.condition, kind: prev.kind }
            : null,
      });
      return Response.json(result);
    }

    if (body.mode === "actors") {
      const need = Array.isArray(body.need)
        ? body.need.filter((n): n is "from" | "to" => n === "from" || n === "to")
        : [];
      if (!isStr(body.utterance, MAX_TEXT) || need.length === 0 || !Array.isArray(body.knownActors)) {
        return Response.json({ error: "入力の形式が正しくありません" }, { status: 400 });
      }
      const result = await extractActors({
        utterance: body.utterance,
        knownActors: body.knownActors.filter((a): a is string => isStr(a, MAX_NAME)).slice(0, 50),
        need,
      });
      return Response.json(result);
    }

    return Response.json({ error: "mode が正しくありません" }, { status: 400 });
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: e.kind === "invalid" ? 422 : 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
