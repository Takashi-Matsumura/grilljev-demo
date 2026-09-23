/**
 * Jev 互換のローカル判定器。server 専用。`JEV_BACKEND=local` のときに `postJev` から呼ばれる。
 *
 * OpenAI 互換サーバ（例: DiffusionGemma を載せた mlx サーバ）に、Jev と同じ state と型つき質問を
 * プロンプトとして渡し、JSON で答えさせて Jev の応答の形に組み直す。**外部には何も送らない。**
 *
 * Jev との違い（呼び出し側の閾値に効くので必ず意識すること）:
 * - 確率は**モデルの自己申告**。logprobs も構造化出力も使えない（拡散モデルは非対応）ため、
 *   各答えに付けさせた確からしさ p から、次のように組み立てる。
 *   - noul: 答えが true なら P(true)=p、false なら 1-p
 *   - choice: 選んだ id に p、残りを他の選択肢へ等分。confidence=p
 *   - score: 選んだ段階に p、残りを隣の段階へ分け、その期待値を score にする
 * - 自己申告の p は 0.7〜1.0 に偏る（実測）。Jev より「言い切り」寄りになる。
 * - 選択肢の id を崩して返すことがある（`__none__` → `__none`）。近いものに寄せ、寄せられなければ
 *   その問の答えは返さない（呼び出し側は「回答なし」として扱う）。
 */

import type {
  JevAnswer,
  JevChoiceQuestion,
  JevQuestion,
  JevResponse,
  JevScoreQuestion,
} from "./jev";

const DEFAULT_BASE_URL = "http://127.0.0.1:8090";

export function localBaseUrl(): string {
  return process.env.JEV_LOCAL_BASE_URL ?? DEFAULT_BASE_URL;
}

/** 拡散モデルは 1 回 4〜8 秒かかる（実測）。Jev の 8 秒では足りない。 */
export function localTimeoutMs(): number {
  const n = Number(process.env.JEV_LOCAL_TIMEOUT_MS ?? 20_000);
  return Number.isFinite(n) && n > 0 ? n : 20_000;
}

let cachedModel: string | null = null;

/** JEV_LOCAL_MODEL が無ければ、サーバが載せている先頭のモデルを使う。 */
export async function localModel(signal?: AbortSignal): Promise<string> {
  const fromEnv = process.env.JEV_LOCAL_MODEL;
  if (fromEnv) return fromEnv;
  if (cachedModel) return cachedModel;
  const res = await fetch(`${localBaseUrl()}/v1/models`, { signal });
  if (!res.ok) throw new Error(`/v1/models が HTTP ${res.status} を返しました`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  const id = json.data?.[0]?.id;
  if (!id) throw new Error("/v1/models にモデルがありません");
  cachedModel = id;
  return id;
}

// ─── プロンプト ──────────────────────────────────────────────────────

function describeQuestion(id: string, q: JevQuestion): string {
  if (q.type === "noul") {
    const c = q.criteria ? `\n  true = ${q.criteria.true}\n  false = ${q.criteria.false}` : "";
    return `- ${id}（true か false）: ${q.instructions}${c}`;
  }
  if (q.type === "choice") {
    const opts = Object.entries(q.criteria)
      .map(([k, d]) => `  "${k}" = ${d}`)
      .join("\n");
    return `- ${id}（次の id から 1 つ。id は一字一句そのまま書く）: ${q.instructions}\n${opts}`;
  }
  const levels = q.criteria.map((d, i) => `  ${i} = ${d}`).join("\n");
  return `- ${id}（0〜${q.criteria.length - 1} の整数）: ${q.instructions}\n${levels}`;
}

function buildPrompt(state: object, questions: Record<string, JevQuestion>): string {
  const ids = Object.keys(questions);
  return [
    "あなたは会議の発話と業務フロー図の状態を読んで、質問に答える判定器です。",
    "",
    "状態（JSON）:",
    JSON.stringify(state),
    "",
    "質問:",
    ...ids.map((id) => describeQuestion(id, questions[id])),
    "",
    "出力は JSON オブジェクト 1 つだけ。先頭は { 、末尾は } にする。説明文やコードブロックは付けない。",
    `キーは質問の id（${ids.join(", ")}）で、全部に答える。`,
    '値は {"answer": <true/false、選択肢の id、または整数>, "p": <その答えが正しい確からしさ 0〜1>}。',
    "迷うときは p を下げる。",
  ].join("\n");
}

// ─── 応答の組み直し ───────────────────────────────────────────────────

type RawAnswer = { answer?: unknown; p?: unknown };

function parseObject(text: string): Record<string, RawAnswer> | null {
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, RawAnswer>)
      : null;
  } catch {
    return null;
  }
}

/**
 * モデルの出力から JSON オブジェクトを取り出す。コードブロックの囲みは捨てる。
 * 外側の `{ }` が抜けて `"chatter": {...}, "intent": {...}` だけが返ることがある（実測）ので、
 * そのときは補って読む。
 */
export function extractJson(text: string): Record<string, RawAnswer> | null {
  const body = text.replace(/```(?:json)?/g, "").trim();
  // `"chatter": ...` で始まる = 外側の括弧が抜けている
  if (body.startsWith('"')) return parseObject(`{${body.replace(/,\s*$/, "")}}`);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? parseObject(body.slice(start, end + 1)) : null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function toProb(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  // 自己申告が無い・壊れているときは、言い切らない値にしておく
  return Number.isFinite(n) ? clamp01(n) : 0.6;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "yes") return true;
    if (s === "false" || s === "no") return false;
  }
  return null;
}

/** 崩れた id（`__none` / `"A1 "` / 大文字小文字違い）を、定義した id に寄せる。 */
export function matchChoice(raw: unknown, ids: string[]): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (ids.includes(s)) return s;
  const norm = (x: string) => x.replace(/^_+|_+$/g, "").toLowerCase();
  const hits = ids.filter((id) => norm(id) === norm(s));
  return hits.length === 1 ? hits[0] : null;
}

function choiceAnswer(q: JevChoiceQuestion, raw: RawAnswer): JevAnswer | null {
  const ids = Object.keys(q.criteria);
  const choice = matchChoice(raw.answer, ids);
  if (!choice) return null;
  // 選んだものが一様分布より低いのは矛盾なので、少なくとも一様にする
  const p = Math.max(toProb(raw.p), 1 / ids.length);
  const rest = ids.length > 1 ? (1 - p) / (ids.length - 1) : 0;
  const probabilities = Object.fromEntries(ids.map((id) => [id, id === choice ? p : rest]));
  return { type: "choice", choice, probabilities, confidence: p };
}

function scoreAnswer(q: JevScoreQuestion, raw: RawAnswer): JevAnswer | null {
  const n = q.criteria.length;
  const v = typeof raw.answer === "number" ? raw.answer : Number(raw.answer);
  if (!Number.isFinite(v)) return null;
  const level = Math.min(n - 1, Math.max(0, Math.round(v)));
  const p = toProb(raw.p);
  // 残りは隣の段階へ。遠い段階へ等分すると、期待値が真ん中へ引っぱられてしまう
  const neighbors = [level - 1, level + 1].filter((i) => i >= 0 && i < n);
  const probs = q.criteria.map((_, i) =>
    i === level ? p : neighbors.includes(i) ? (1 - p) / neighbors.length : 0,
  );
  const score = probs.reduce((s, pi, i) => s + pi * i, 0);
  return {
    type: "score",
    score,
    legend: Object.fromEntries(q.criteria.map((d, i) => [String(i), d])),
    probabilities: Object.fromEntries(probs.map((pi, i) => [String(i), pi])),
    confidence: p,
  };
}

/** モデルの生の答えを、Jev の答えの形に直す。直せないものは入れない。 */
export function toJevAnswers(
  raw: Record<string, RawAnswer>,
  questions: Record<string, JevQuestion>,
): Record<string, JevAnswer> {
  const out: Record<string, JevAnswer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const r = raw[id];
    if (typeof r !== "object" || r === null) continue;
    let a: JevAnswer | null = null;
    if (q.type === "noul") {
      const b = toBool(r.answer);
      if (b !== null) {
        const p = toProb(r.p);
        a = { type: "noul", noul: b ? p : 1 - p };
      }
    } else if (q.type === "choice") {
      a = choiceAnswer(q, r);
    } else {
      a = scoreAnswer(q, r);
    }
    if (a) out[id] = a;
  }
  return out;
}

// ─── 呼び出し ────────────────────────────────────────────────────────

export type LocalCallResult = {
  model: string;
  response: JevResponse;
};

/** 答えがこれより少なければ、1 度だけ聞き直す（JSON が壊れた・大半を答えなかった）。 */
const MIN_ANSWERED_RATIO = 0.5;

/**
 * 1 回の判定。エラーは素の Error / fetch の例外のまま投げる（JevError への分類は postJev が行う）。
 * HTTP エラーは `status` を付けて投げる。
 */
export async function postLocal(
  state: object,
  questions: Record<string, JevQuestion>,
  signal: AbortSignal,
): Promise<LocalCallResult> {
  const model = await localModel(signal);
  const nQ = Object.keys(questions).length;
  const content = buildPrompt(state, questions);
  const body = (temperature: number) =>
    JSON.stringify({
      model,
      messages: [{ role: "user", content }],
      temperature,
      // 1 問あたり 20〜25 トークン（実測）。余裕を持たせる
      max_tokens: 200 + nQ * 60,
    });

  let best: LocalCallResult | null = null;
  let inTok = 0;
  let outTok = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${localBaseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 温度 0 だと聞き直しても同じ答えが返るので、2 回目は少し揺らす
      body: body(attempt === 0 ? 0 : 0.4),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw Object.assign(new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`), {
        status: res.status,
      });
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    inTok += json.usage?.prompt_tokens ?? 0;
    outTok += json.usage?.completion_tokens ?? 0;
    const raw = extractJson(json.choices?.[0]?.message?.content ?? "");
    const answers = raw ? toJevAnswers(raw, questions) : {};
    const count = Object.keys(answers).length;
    if (!best || count > Object.keys(best.response.answers).length) {
      best = { model, response: { model, answers, usage: { input_tokens: 0, output_tokens: 0 } } };
    }
    if (count >= nQ * MIN_ANSWERED_RATIO) break;
  }

  // ループは最低 1 回回るので best は必ずある
  const result = best!;
  result.response.usage = { input_tokens: inTok, output_tokens: outTok };
  if (Object.keys(result.response.answers).length === 0) {
    // 502 は一時的な失敗として回路ブレーカに数えられる
    throw Object.assign(new Error("ローカル判定器の応答を JSON として読めませんでした"), {
      status: 502,
    });
  }
  return result;
}
