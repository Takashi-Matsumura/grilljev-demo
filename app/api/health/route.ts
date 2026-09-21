import { checkHealth } from "@/lib/health";

// 毎回実測する。キャッシュされると「起動した」のに赤いままになる。
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await checkHealth(), {
    headers: { "Cache-Control": "no-store" },
  });
}
