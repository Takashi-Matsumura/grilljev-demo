import { deleteSession, readSession, saveSession } from "@/lib/store/sessions";
import { parseSessionPatch } from "@/lib/store/session-types";

export const dynamic = "force-dynamic";

/** 保存本体の上限。文字起こし 2000 行 + 図の履歴が収まる大きさ。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const file = await readSession(slug);
  if (!file) return Response.json({ error: "セッションが見つかりません" }, { status: 404 });
  return Response.json(file, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: Request, { params }: Ctx) {
  const { slug } = await params;
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: "大きすぎます" }, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // 下で 400
  }
  const patch = parseSessionPatch(body);
  if (!patch) return Response.json({ error: "保存内容の形式が正しくありません" }, { status: 400 });
  const saved = await saveSession(slug, patch);
  if (!saved) return Response.json({ error: "セッションが見つかりません" }, { status: 404 });
  return Response.json({ updatedAt: saved.updatedAt });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const ok = await deleteSession(slug);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "セッションが見つかりません" }, { status: 404 });
}
