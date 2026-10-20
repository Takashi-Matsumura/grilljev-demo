import { LlmError } from "@/lib/llm";
import { MAX_NAME_CHARS, MAX_SEED_ACTORS, parseName } from "@/lib/store/session-types";
import { suggestActors } from "@/lib/suggest/actors";

export const dynamic = "force-dynamic";

/** 業務名から、登場人物の候補を出す（開始画面の「候補を出す」）。 */
export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const title = parseName(b.title);
  if (!title) return Response.json({ error: `業務名を入力してください（${MAX_NAME_CHARS} 文字以内）` }, { status: 400 });
  const known = Array.isArray(b.known)
    ? b.known.filter((n): n is string => typeof n === "string" && n.length <= 60).slice(0, MAX_SEED_ACTORS)
    : [];

  try {
    return Response.json(await suggestActors(title, known));
  } catch (e) {
    if (e instanceof LlmError) {
      return Response.json({ error: e.message, kind: e.kind }, { status: e.kind === "invalid" ? 422 : 502 });
    }
    return Response.json({ error: e instanceof Error ? e.message : "不明なエラー" }, { status: 500 });
  }
}
