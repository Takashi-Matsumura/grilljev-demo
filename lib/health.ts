/**
 * 3 つのバックエンドの疎通確認。server 専用（process.env を読む）。
 *
 * Jev は従量課金の外部 API なので、疎通確認では呼び出さない。
 * 「キーが設定されているか」だけを見る（実際の応答は段階 3 の /api/analyze で確かめる）。
 * ローカル判定器（JEV_BACKEND=local）はタダなので、/v1/models で実際に疎通を見る。
 */

import { jevBackend } from "./jev";
import { localBaseUrl } from "./jev-local";

export type ServiceStatus = {
  ok: boolean;
  /** 画面にそのまま出す短い説明 */
  detail: string;
};

export type Health = {
  whisper: ServiceStatus;
  llama: ServiceStatus & { model?: string; nCtx?: number };
  jev: ServiceStatus;
  checkedAt: string;
};

const PROBE_TIMEOUT_MS = 2_000;

function whisperBaseUrl(): string {
  return process.env.WHISPER_BASE_URL ?? "http://127.0.0.1:8178";
}

function llamaBaseUrl(): string {
  return process.env.LLAMA_BASE_URL ?? "http://localhost:8080";
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === "TimeoutError") return "応答がありません（タイムアウト）";
    // Node の fetch は原因を cause に入れる（ECONNREFUSED など）
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code === "ECONNREFUSED") return "起動していません";
    return e.message;
  }
  return "不明なエラー";
}

async function checkWhisper(): Promise<ServiceStatus> {
  const base = whisperBaseUrl();
  try {
    // whisper-server は / に UI を返す（--public が無ければ 404）。
    // 200 でなくても「応答した」ことが分かれば起動はしている。
    await fetch(`${base}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return { ok: true, detail: base };
  } catch (e) {
    return { ok: false, detail: `${base}: ${errorMessage(e)}（npm run whisper で起動）` };
  }
}

async function checkLlama(): Promise<Health["llama"]> {
  const base = llamaBaseUrl();
  try {
    const res = await fetch(`${base}/v1/models`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, detail: `${base}: HTTP ${res.status}` };
    const json = (await res.json()) as {
      data?: { id?: string; meta?: { n_ctx?: number } }[];
    };
    const model = json.data?.[0];
    return {
      ok: true,
      detail: base,
      model: model?.id,
      nCtx: model?.meta?.n_ctx,
    };
  } catch (e) {
    return { ok: false, detail: `${base}: ${errorMessage(e)}` };
  }
}

async function checkLocalJev(): Promise<ServiceStatus> {
  const base = localBaseUrl();
  try {
    const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!res.ok) return { ok: false, detail: `ローカル判定器 ${base}: HTTP ${res.status}` };
    const json = (await res.json()) as { data?: { id?: string }[] };
    const model = process.env.JEV_LOCAL_MODEL ?? json.data?.[0]?.id ?? "モデル不明";
    return { ok: true, detail: `ローカル判定器 ${base}（${model}）` };
  } catch (e) {
    return { ok: false, detail: `ローカル判定器 ${base}: ${errorMessage(e)}` };
  }
}

async function checkJev(): Promise<ServiceStatus> {
  if (jevBackend() === "local") return checkLocalJev();
  return process.env.TYPESAFE_API_KEY
    ? { ok: true, detail: "TYPESAFE_API_KEY 設定済み（疎通は未確認）" }
    : { ok: false, detail: "TYPESAFE_API_KEY が未設定（.env.local に設定）" };
}

export async function checkHealth(): Promise<Health> {
  const [whisper, llama, jev] = await Promise.all([checkWhisper(), checkLlama(), checkJev()]);
  return { whisper, llama, jev, checkedAt: new Date().toISOString() };
}
