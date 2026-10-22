export const dynamic = "force-dynamic";

/** 字幕 1 場面ぶん。これより長い文は、プレビューの字幕としても長すぎる */
const MAX_TEXT_CHARS = 400;
const VOICEVOX_TIMEOUT_MS = 20_000;
/** VOICEVOX の speedScale が受け付ける範囲 */
const MIN_SPEED = 0.5;
const MAX_SPEED = 2;

function baseUrl(): string {
  return process.env.VOICEVOX_BASE_URL ?? "http://127.0.0.1:50021";
}

/** 話者（スタイル）ID はサーバ側の設定だけで決める。ブラウザからは選ばせない */
function speakerId(): number {
  const n = Number(process.env.VOICEVOX_SPEAKER ?? 8);
  return Number.isInteger(n) && n >= 0 ? n : 8;
}

function describeFailure(base: string, e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") {
    return `VOICEVOX (${base}) が ${VOICEVOX_TIMEOUT_MS / 1000} 秒以内に応答しませんでした`;
  }
  const cause = e instanceof Error ? (e as { cause?: { code?: string } }).cause : undefined;
  if (cause?.code === "ECONNREFUSED") {
    return `VOICEVOX (${base}) が起動していません`;
  }
  return `VOICEVOX (${base}): ${e instanceof Error ? e.message : "不明なエラー"}`;
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl()}${path}`, { ...init, signal: AbortSignal.timeout(VOICEVOX_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

// 話者名はエンジンを入れ替えない限り変わらないので、一度引いたら覚えておく
let credit: { speaker: number; text: string } | null = null;

/**
 * 読み上げに使う声のクレジット（「VOICEVOX:春日部つむぎ」）。
 * VOICEVOX の利用規約で、音声を使う画面に表記が要る。疎通確認も兼ねる。
 */
export async function GET() {
  const speaker = speakerId();
  try {
    if (credit?.speaker !== speaker) {
      const res = await call("/speakers");
      const speakers = (await res.json()) as { name: string; styles: { id: number }[] }[];
      const found = speakers.find((s) => s.styles.some((st) => st.id === speaker));
      if (!found) throw new Error(`話者 ${speaker} がエンジンにありません（VOICEVOX_SPEAKER を確認）`);
      credit = { speaker, text: `VOICEVOX:${found.name}` };
    }
    return Response.json({ credit: credit.text });
  } catch (e) {
    return Response.json({ error: describeFailure(baseUrl(), e) }, { status: 502 });
  }
}

/** 字幕 1 つを読み上げた WAV を返す */
export async function POST(request: Request) {
  let body: { text?: unknown; speed?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON を解析できません" }, { status: 400 });
  }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) return Response.json({ error: "text がありません" }, { status: 400 });
  if (text.length > MAX_TEXT_CHARS) return Response.json({ error: "text が長すぎます" }, { status: 413 });
  const speed =
    typeof body.speed === "number" && Number.isFinite(body.speed)
      ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, body.speed))
      : 1;

  const speaker = String(speakerId());
  try {
    // VOICEVOX は 2 段階。読み・アクセントを作ってから（audio_query）、それを音にする（synthesis）
    const query = (await (
      await call(`/audio_query?${new URLSearchParams({ text, speaker })}`, { method: "POST" })
    ).json()) as Record<string, unknown>;
    query.speedScale = speed;
    const wav = await call(`/synthesis?${new URLSearchParams({ speaker })}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(query),
    });
    return new Response(await wav.arrayBuffer(), {
      headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json({ error: describeFailure(baseUrl(), e) }, { status: 502 });
  }
}
