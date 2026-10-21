import { deleteDiagram, readDiagram, renameDiagram, saveDiagram } from "@/lib/store/diagrams";
import { parseDiagramPatch } from "@/lib/store/diagram-types";
import { parseName } from "@/lib/store/session-types";

export const dynamic = "force-dynamic";

/** 保存本体の上限。図だけなので会議（8MB）より小さくてよい。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const file = await readDiagram(slug);
  if (!file) return Response.json({ error: "図が見つかりません" }, { status: 404 });
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
  const patch = parseDiagramPatch(body);
  if (!patch) return Response.json({ error: "保存内容の形式が正しくありません" }, { status: 400 });
  const saved = await saveDiagram(slug, patch);
  if (!saved) return Response.json({ error: "図が見つかりません" }, { status: 404 });
  return Response.json({ updatedAt: saved.updatedAt });
}

/** 図の名前（＝業務名）だけを変える。 */
export async function PATCH(request: Request, { params }: Ctx) {
  const { slug } = await params;
  const body: unknown = await request.json().catch(() => null);
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const name = parseName(b.name);
  if (!name) return Response.json({ error: "業務名を入力してください（60 文字以内）" }, { status: 400 });
  const renamed = await renameDiagram(slug, name);
  if (!renamed) return Response.json({ error: "図が見つかりません" }, { status: 404 });
  return Response.json({ name: renamed.name, updatedAt: renamed.updatedAt });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const ok = await deleteDiagram(slug);
  return ok ? new Response(null, { status: 204 }) : Response.json({ error: "図が見つかりません" }, { status: 404 });
}
