/**
 * llama-server（OpenAI 互換 /v1/chat/completions）の薄いクライアント。server 専用。
 *
 * - **アイドルタイムアウト方式**: トークン（思考トークンを含む）が届くたびにタイマーを戻す。
 *   長いプリフィルでも、途中で出力が出始めれば延長され、本当に固まったときだけ落ちる。
 * - **思考（reasoning）は既定で止める**。gemma は既定だと短い JSON を返すのにも
 *   約 200 トークンの思考を挟み、実測で 14 秒かかった（止めると 1.3 秒・9 トークン）。
 *   ステップ名のような短い出力に思考は要らない。
 * - 全体の上限（totalTimeoutMs）も別に持つ。会議中に生成が詰まっても図を待たせないため。
 */

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  /** true のときだけ思考を許す。既定 false */
  thinking?: boolean;
  /** 全体の上限。既定 20 秒 */
  totalTimeoutMs?: number;
};

export type LlmErrorKind = "unreachable" | "timeout" | "http" | "invalid";

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: LlmErrorKind,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

const DEFAULT_TOTAL_TIMEOUT_MS = 20_000;

function baseUrl(): string {
  return process.env.LLAMA_BASE_URL ?? "http://localhost:8080";
}

function idleTimeoutMs(): number {
  const n = Number(process.env.LLAMA_IDLE_TIMEOUT_MS ?? 120_000);
  return Number.isFinite(n) && n > 0 ? n : 120_000;
}

/** ストリーミングで呼び、最終的な本文（content のみ。思考は含めない）を返す。 */
export async function chatCompletion(
  messages: LlmMessage[],
  opts: ChatOptions = {},
): Promise<string> {
  const base = baseUrl();
  const ctrl = new AbortController();
  let abortedBy: "idle" | "total" | null = null;

  const idle = idleTimeoutMs();
  let idleTimer = setTimeout(() => {
    abortedBy = "idle";
    ctrl.abort();
  }, idle);
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      abortedBy = "idle";
      ctrl.abort();
    }, idle);
  };
  const totalTimer = setTimeout(() => {
    abortedBy = "total";
    ctrl.abort();
  }, opts.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  const cleanup = () => {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  };

  try {
    let res: Response;
    try {
      res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.LLAMA_MODEL ?? "gemma",
          messages,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 300,
          stream: true,
          chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      if (abortedBy) throw timeoutError(abortedBy);
      const cause = (e as { cause?: { code?: string } }).cause;
      throw new LlmError(
        cause?.code === "ECONNREFUSED"
          ? `llama-server (${base}) が起動していません`
          : `llama-server (${base}) に接続できません: ${e instanceof Error ? e.message : "不明なエラー"}`,
        "unreachable",
      );
    }

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new LlmError(`llama-server が HTTP ${res.status} を返しました: ${body.slice(0, 200)}`, "http");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "" || data === "[DONE]") continue;
          try {
            const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const token = json.choices?.[0]?.delta?.content;
            if (token) content += token;
          } catch {
            // 壊れたチャンクは無視する
          }
        }
      }
    } catch (e) {
      if (abortedBy) throw timeoutError(abortedBy);
      throw e;
    } finally {
      reader.cancel().catch(() => {});
    }
    return content;
  } finally {
    cleanup();
  }
}

function timeoutError(by: "idle" | "total"): LlmError {
  return new LlmError(
    by === "idle"
      ? "llama-server が無応答のためアボートしました"
      : "llama-server の応答が時間内に終わりませんでした",
    "timeout",
  );
}
