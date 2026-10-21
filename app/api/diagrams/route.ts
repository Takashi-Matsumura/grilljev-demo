import { createDiagram, listDiagrams } from "@/lib/store/diagrams";
import { parseName } from "@/lib/store/session-types";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ diagrams: await listDiagrams() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const name = parseName(b.name);
  if (!name) return Response.json({ error: "業務名を入力してください（60 文字以内）" }, { status: 400 });
  const created = await createDiagram(name);
  return Response.json({ slug: created.slug }, { status: 201 });
}
