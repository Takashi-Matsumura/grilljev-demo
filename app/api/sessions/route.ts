import { createSession, listSessions } from "@/lib/store/sessions";
import { parseName, parseSeed } from "@/lib/store/session-types";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ sessions: await listSessions() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const seed = parseSeed(b.title, b.departments);
  if (!seed) return Response.json({ error: "業務名を入力してください（60 文字以内）" }, { status: 400 });
  const name = parseName(b.name) ?? seed.title;
  const created = await createSession(name, seed);
  return Response.json({ slug: created.slug }, { status: 201 });
}
