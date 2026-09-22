import { cleanJapanese } from "@/lib/transcribe/clean";
import { MAX_VOCAB_CHARS } from "@/lib/transcript/vocab";

export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 16kHz/16bit で 12 秒 ≈ 0.4MB。十分な余裕
const WHISPER_TIMEOUT_MS = 25_000;

// whisper-server はモデル 1 個を排他で使うので、並列に投げても速くならない。
// ここで明示的に直列化し、待ち行列の長さをクライアントへ返す（セグメント長を縮める判断材料）。
let chain: Promise<unknown> = Promise.resolve();
let depth = 0;

function serial<T>(task: () => Promise<T>): Promise<T> {
  depth += 1;
  const run = chain.then(task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    depth -= 1;
  });
}

function describeFailure(base: string, e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") {
    return `whisper-server (${base}) が ${WHISPER_TIMEOUT_MS / 1000} 秒以内に応答しませんでした`;
  }
  const cause = e instanceof Error ? (e as { cause?: { code?: string } }).cause : undefined;
  if (cause?.code === "ECONNREFUSED") {
    return `whisper-server (${base}) が起動していません（npm run whisper）`;
  }
  return `whisper-server (${base}): ${e instanceof Error ? e.message : "不明なエラー"}`;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "multipart/form-data を解析できません" }, { status: 400 });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json({ error: "audio がありません" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "audio が大きすぎます" }, { status: 413 });
  }
  const vocabField = form.get("vocab");
  const vocab = typeof vocabField === "string" ? vocabField.trim().slice(0, MAX_VOCAB_CHARS) : "";

  const base = process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8178";
  const queueDepth = depth + 1; // 自分を含む
  const startedAt = performance.now();

  try {
    const raw = await serial(async () => {
      const upstream = new FormData();
      upstream.append("file", audio, "segment.wav");
      upstream.append("response_format", "json");
      upstream.append("language", "ja");
      upstream.append("temperature", "0");
      // 業務名・部署名などを初期プロンプトに入れて、固有名詞の認識を寄せる
      if (vocab) upstream.append("prompt", vocab);

      const res = await fetch(`${base}/inference`, {
        method: "POST",
        body: upstream,
        signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as { text?: string };
      return (json.text ?? "").trim();
    });

    // 無音に対して初期プロンプトをそのまま返してくる挙動への保険
    const echoed = vocab !== "" && raw === vocab;
    const cleaned = echoed ? { text: "", filtered: true } : cleanJapanese(raw);

    return Response.json({
      text: cleaned.text,
      raw,
      filtered: cleaned.filtered,
      latencyMs: Math.round(performance.now() - startedAt),
      queueDepth,
    });
  } catch (e) {
    return Response.json({ error: describeFailure(base, e) }, { status: 502 });
  }
}
