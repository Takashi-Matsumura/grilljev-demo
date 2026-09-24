/**
 * TypeSafe AI / Jev (System One) のクライアント。https://docs.typesafe.ai/api
 *
 * **server 専用。** API キーはここから先へ出さない。
 *
 * Jev はテキストを生成しない。`state` と型つきの質問を送ると、各質問に
 * 確率つきの型安全な答えだけを返す。全質問は並列評価されるので、質問を足しても
 * レイテンシはほぼ増えない（1 発話 1 リクエストに詰める）。
 *
 * **外部送信であることに注意。** state に入れたものは TypeSafe のサーバへ送られる。
 * 音声は外に出ないが、文字起こしテキストとフロー要素（アクター名・ステップ名・業務名）は出る。
 *
 * 送り先は画面（バックエンドの状態ダイアログ）で切り替えられ、ブラウザの cookie
 * （`JEV_BACKEND_COOKIE`）に入る。cookie が無ければ `JEV_BACKEND` の値に従う。
 * `local` のときは同じ質問をローカルの OpenAI 互換サーバに答えさせる（`./jev-local`）。
 * 呼び出し側は何も変えなくてよいが、確率の性質が違う点に注意。
 */

import { cookies } from "next/headers";
import { JEV_BACKEND_COOKIE, parseJevBackend, type JevBackend } from "./jev-backend";
import { localBaseUrl, localTimeoutMs, postLocal } from "./jev-local";

export type { JevBackend } from "./jev-backend";

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

/** cookie が無いときの送り先。既定は TypeSafe。`JEV_BACKEND=local` のときだけローカル判定器。 */
export function defaultJevBackend(): JevBackend {
  return parseJevBackend(process.env.JEV_BACKEND) ?? "typesafe";
}

/**
 * このリクエストの送り先。画面で選んだもの（cookie）、無ければ既定。リクエストの中でだけ呼べる。
 * API キーが無いときの Jev は選べない扱いにして、ローカル判定器へ回す（画面でも選べなくしてある）。
 */
export async function currentJevBackend(): Promise<JevBackend> {
  const store = await cookies();
  const chosen = parseJevBackend(store.get(JEV_BACKEND_COOKIE)?.value) ?? defaultJevBackend();
  return chosen === "typesafe" && !hasJevApiKey() ? "local" : chosen;
}

/** 応答を待つ上限。ネットが遅いときに会議の進行を止めない。 */
const TIMEOUT_MS = 8_000;
/** これだけ連続で失敗したら休む。 */
const COOL_DOWN_AFTER = 3;
/** 休む時間。ネットが死んでいるときに毎回 8 秒待つのが最悪の体験なので必須。 */
const COOL_DOWN_MS = 5 * 60_000;

// ─── ワイヤ形式（Jev の API そのままの語彙） ────────────────────────────

/** 二値。P(true) が返る。confidence は返らない。 */
export type JevNoulQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

/** 定義した選択肢のうち 1 つ + 各選択肢の確率 + confidence が返る。 */
export type JevChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/** 順序つきレベル（2〜10 段階）上の位置が返る。 */
export type JevScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type JevQuestion = JevNoulQuestion | JevChoiceQuestion | JevScoreQuestion;

export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};
export type JevAnswer = JevNoulAnswer | JevChoiceAnswer | JevScoreAnswer;

export type JevResponse = {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * 1 回のやり取りの記録。**送った内容をそのまま持つ**のが要点。
 * 画面に出しているものが実際に送信したものと一致していないと、
 * 「外に出ているのはこれだけです」と言えなくなる。呼び出し側は組み立て直さないこと。
 */
export type JevExchange<S> = {
  request: {
    endpoint: string;
    model: string;
    state: S;
    questions: Record<string, JevQuestion>;
  };
  response: JevResponse;
  /** サーバ側で計測した応答時間（ミリ秒） */
  elapsedMs: number;
};

export type JevErrorKind =
  | "config"
  | "breaker"
  | "timeout"
  | "network"
  | "auth"
  | "invalid"
  | "rate_limit"
  | "overloaded"
  | "server";

/**
 * 失敗したときに「何を送って、何が返ってきたか」を残すための情報。
 * ローカル判定器は Jev と違って JSON が崩れることがあり、そのときこそ中身を見たい。
 * 送った内容は必ず分かるので、返答が読めなかった場合も request 側は埋まる。
 */
export type JevFailureDebug = {
  endpoint: string;
  model: string;
  state: unknown;
  questions: Record<string, JevQuestion>;
  /** モデルが返した生のテキスト。JSON として読めなかったものをそのまま入れる */
  rawResponse?: string;
  elapsedMs: number;
};

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: JevErrorKind,
    /** コンソールに出す、送信内容と生の応答。取れなかったときは undefined */
    readonly debug?: JevFailureDebug,
  ) {
    super(message);
    this.name = "JevError";
  }
}

// ─── 回路ブレーカ ────────────────────────────────────────────────────

/** 送り先ごとに持つ。片方が落ちて休止中でも、切り替えた先はすぐ使えるようにする。 */
const breakers: Record<JevBackend, { failures: number; coolUntil: number }> = {
  typesafe: { failures: 0, coolUntil: 0 },
  local: { failures: 0, coolUntil: 0 },
};

/** 一時的な失敗（回復しうるもの）だけを数える。401/422 は設定・実装の誤りなので数えない。 */
function recordFailure(backend: JevBackend): void {
  const breaker = breakers[backend];
  breaker.failures += 1;
  if (breaker.failures >= COOL_DOWN_AFTER) {
    breaker.coolUntil = Date.now() + COOL_DOWN_MS;
    breaker.failures = 0;
  }
}

function recordSuccess(backend: JevBackend): void {
  const breaker = breakers[backend];
  breaker.failures = 0;
  breaker.coolUntil = 0;
}

export function jevBreakerState(backend: JevBackend): { coolingDown: boolean; retryAfterMs: number } {
  const retryAfterMs = Math.max(0, breakers[backend].coolUntil - Date.now());
  return { coolingDown: retryAfterMs > 0, retryAfterMs };
}

function classify(status: number): JevErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 422 || status === 400) return "invalid";
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  return "server";
}

function isTransient(status: number): boolean {
  return status === 429 || status === 529 || status >= 500;
}

export function hasJevApiKey(): boolean {
  return !!process.env.TYPESAFE_API_KEY;
}

/** 1 回の呼び出しの結果。どのバックエンドに送ったかも持つ（コンソールにそのまま出す）。 */
type BackendResult = { endpoint: string; model: string; response: JevResponse };

type Backend = {
  name: string;
  timeoutMs: number;
  call: (state: object, questions: Record<string, JevQuestion>, signal: AbortSignal) => Promise<BackendResult>;
};

const typesafeBackend: Backend = {
  name: "Jev",
  timeoutMs: TIMEOUT_MS,
  async call(state, questions, signal) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (!apiKey) throw new JevError("TYPESAFE_API_KEY が設定されていません", 500, "config");
    const res = await fetch(JEV_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw Object.assign(new Error(`Jev API が ${res.status} を返しました: ${body.slice(0, 300)}`), {
        status: res.status,
      });
    }
    return { endpoint: JEV_ENDPOINT, model: JEV_MODEL, response: (await res.json()) as JevResponse };
  },
};

const localBackend: Backend = {
  name: "ローカル判定器",
  get timeoutMs() {
    return localTimeoutMs();
  },
  async call(state, questions, signal) {
    const r = await postLocal(state, questions, signal);
    return { endpoint: `${localBaseUrl()}/v1/chat/completions`, model: r.model, response: r.response };
  },
};

/** state と型つき質問群を 1 回のコールで並列評価させる。 */
export async function postJev<S extends object>(
  state: S,
  questions: Record<string, JevQuestion>,
  signal?: AbortSignal,
): Promise<JevExchange<S>> {
  const which = await currentJevBackend();
  const backend = which === "local" ? localBackend : typesafeBackend;

  const { coolingDown, retryAfterMs } = jevBreakerState(which);
  if (coolingDown) {
    throw new JevError(
      `${backend.name}が連続で失敗したため休止中です（あと ${Math.ceil(retryAfterMs / 1000)} 秒）`,
      503,
      "breaker",
    );
  }

  const startedAt = performance.now();
  const timeoutMs = backend.timeoutMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;

  let result: BackendResult;
  try {
    result = await backend.call(state, questions, combined);
  } catch (e) {
    if (e instanceof JevError) throw e;
    // 送った内容は必ず分かる。バックエンドが生の応答を添えていれば、それも一緒に残す。
    const attached = (e as { debug?: Partial<JevFailureDebug> }).debug;
    const debug: JevFailureDebug = {
      endpoint: attached?.endpoint ?? backend.name,
      model: attached?.model ?? "",
      state,
      questions,
      rawResponse: attached?.rawResponse,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
    if (timeout.aborted) {
      recordFailure(which);
      throw new JevError(
        `${backend.name}が ${timeoutMs / 1000} 秒以内に応答しませんでした`,
        504,
        "timeout",
        debug,
      );
    }
    if (signal?.aborted) throw e;
    const status = (e as { status?: unknown }).status;
    if (typeof status === "number") {
      if (isTransient(status)) recordFailure(which);
      throw new JevError((e as Error).message, status, classify(status), debug);
    }
    recordFailure(which);
    throw new JevError(
      `${backend.name}に接続できません: ${e instanceof Error ? e.message : "不明なエラー"}`,
      502,
      "network",
      debug,
    );
  }

  recordSuccess(which);
  return {
    request: { endpoint: result.endpoint, model: result.model, state, questions },
    response: result.response,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
