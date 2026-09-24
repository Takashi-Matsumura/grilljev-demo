"use client";

import { useState } from "react";
import type { Interpretation, Verdict } from "@/lib/analysis/interpret";
import type { JevAnswer, JevExchange, JevFailureDebug } from "@/lib/jev";
import { DisclosureIcon } from "./disclosure-icon";

/** 1 回の Jev 呼び出しの記録。送った内容・返ってきた内容は組み立て直さず、そのまま持つ。 */
export type ConsoleEntry = {
  id: string;
  at: string;
  /** 見出しに出す文。発話の判定なら発話、それ以外なら何の呼び出しか */
  utterance: string;
  exchange?: JevExchange<object>;
  interpretation?: Interpretation;
  error?: string;
  /** 失敗したときに、何を送って何が返ってきたか。成功時は exchange の方に入る */
  debug?: JevFailureDebug;
  /** 発話の判定以外の呼び出し（問いかけの選別・対象業務の変化）。バッジと説明に使う */
  kind?: "facilitator" | "scope";
  note?: string;
};

const VERDICT_LABEL: Record<Verdict, { label: string; cls: string }> = {
  drop: { label: "雑談", cls: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300" },
  apply: { label: "反映", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
  confirm: { label: "要確認", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  unchanged: { label: "変更なし", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300" },
};

type Tab = "qa" | "request" | "response";

function Bar({ value, cls = "bg-emerald-500" }: { value: number; cls?: string }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-black/10 align-middle dark:bg-white/15">
      <span
        className={`block h-full ${cls}`}
        style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }}
      />
    </span>
  );
}

function AnswerCell({ answer, levels }: { answer: JevAnswer | undefined; levels?: number }) {
  if (!answer) return <span className="text-zinc-400">（回答なし）</span>;
  if (answer.type === "noul") {
    return (
      <span className="tabular-nums">
        <Bar value={answer.noul} /> {answer.noul.toFixed(2)}
      </span>
    );
  }
  if (answer.type === "score") {
    const max = Math.max(1, (levels ?? 5) - 1);
    return (
      <span className="tabular-nums">
        <Bar value={answer.score / max} cls="bg-sky-500" /> {answer.score.toFixed(2)}/{max}
        <span className="ml-2 text-zinc-400">確信 {answer.confidence.toFixed(2)}</span>
      </span>
    );
  }
  const top = Object.entries(answer.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <span className="tabular-nums">
      <span className="font-medium">{answer.choice}</span>
      <span className="ml-2 text-zinc-400">確信 {answer.confidence.toFixed(2)}</span>
      <span className="block break-words text-zinc-500">
        {top.map(([k, p]) => `${k} ${p.toFixed(2)}`).join(" · ")}
      </span>
    </span>
  );
}

function EntryDetail({ entry }: { entry: ConsoleEntry }) {
  const [tab, setTab] = useState<Tab>("qa");
  const x = entry.exchange;
  if (!x) return null;
  const tabBtn = (t: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded px-2 py-1 text-xs ${
        tab === t ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex gap-1">
        {tabBtn("qa", "質問と回答")}
        {tabBtn("request", "送信 JSON")}
        {tabBtn("response", "受信 JSON")}
      </div>
      {tab === "qa" && (
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(x.request.questions).map(([id, q]) => (
              <tr key={id} className="border-t border-black/5 align-top dark:border-white/10">
                <th
                  scope="row"
                  title={q.instructions}
                  className="w-32 py-1 pr-2 text-left font-normal break-words text-zinc-600 dark:text-zinc-400"
                >
                  {id}
                  <span className="block text-zinc-400">{q.type}</span>
                </th>
                <td className="py-1">
                  <AnswerCell
                    answer={x.response.answers[id]}
                    levels={q.type === "score" ? q.criteria.length : undefined}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "request" && (
        <pre className="max-h-96 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-white/10">
          {JSON.stringify(
            { model: x.request.model, state: x.request.state, questions: x.request.questions },
            null,
            2,
          )}
        </pre>
      )}
      {tab === "response" && (
        <pre className="max-h-96 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-white/10">
          {JSON.stringify(x.response, null, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * 失敗したときの中身。成功時の EntryDetail と同じ見た目で、送った内容と生の応答を出す。
 * ローカル判定器（拡散モデル）は JSON が崩れることがあり、何が返ってきたのかが
 * 分からないと直しようがないので、既定では「受信（生）」を開いておく。
 */
function FailureDetail({ debug }: { debug: JevFailureDebug }) {
  const [tab, setTab] = useState<"request" | "raw">("raw");
  const tabBtn = (t: "request" | "raw", label: string) => (
    <button
      type="button"
      onClick={() => setTab(t)}
      className={`rounded px-2 py-1 text-xs ${
        tab === t ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="mt-2 flex flex-col gap-2">
      <p className="text-xs break-all text-zinc-500">
        {debug.endpoint}
        {debug.model ? ` · ${debug.model}` : ""} · {debug.elapsedMs}ms
      </p>
      <div className="flex gap-1">
        {tabBtn("raw", "受信（生）")}
        {tabBtn("request", "送信 JSON")}
      </div>
      {tab === "raw" &&
        (debug.rawResponse ? (
          <pre className="max-h-96 overflow-auto rounded bg-red-50 p-2 text-xs whitespace-pre-wrap dark:bg-red-500/10">
            {debug.rawResponse}
          </pre>
        ) : (
          <p className="text-xs text-zinc-500">
            応答そのものが返っていません（接続できない・時間切れなど）。
          </p>
        ))}
      {tab === "request" && (
        <pre className="max-h-96 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-white/10">
          {JSON.stringify(
            { model: debug.model, state: debug.state, questions: debug.questions },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

/**
 * 右端の列。折りたためる。畳んでも記録（entries）は親が持っているので失われない。
 * 広い画面では細い帯（縦書きのラベルと回数）に縮み、狭い画面では横長の帯になる。
 */
export function JevConsole({ entries }: { entries: ConsoleEntry[] }) {
  const [open, setOpen] = useState(true);

  const ok = entries.filter((e) => e.exchange);
  const calls = ok.length;
  const inTok = ok.reduce((s, e) => s + (e.exchange?.response.usage.input_tokens ?? 0), 0);
  const outTok = ok.reduce((s, e) => s + (e.exchange?.response.usage.output_tokens ?? 0), 0);
  const avgMs = calls
    ? Math.round(ok.reduce((s, e) => s + (e.exchange?.elapsedMs ?? 0), 0) / calls)
    : 0;
  const failed = entries.length - calls;

  if (!open) {
    // 畳んだときは 1 行分で足りるが、縦積みで縮められて潰れないよう shrink-0 にする
    return (
      <aside className="shrink-0 border-t border-black/10 lg:h-full lg:border-l lg:border-t-0 dark:border-white/15">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="jev-console-body"
          title="Jev コンソールを開く"
          aria-label="Jev コンソールを開く"
          className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-black/5 lg:h-full lg:w-12 lg:flex-col lg:px-0 dark:hover:bg-white/10"
        >
          {/* 畳むアイコンと対になる、右側のパネルを開くアイコン（山形が左向き） */}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
            <path d="M11 9.5 8.5 12l2.5 2.5" />
          </svg>
          <span className="font-medium lg:[writing-mode:vertical-rl]">Jev コンソール</span>
          <span className="text-xs tabular-nums text-zinc-500 lg:[writing-mode:vertical-rl]">
            {calls} 回{failed > 0 ? ` · 失敗 ${failed}` : ""}
          </span>
        </button>
      </aside>
    );
  }

  // 縦積み（1024px 未満）では、左ペイン・図ペインと同じ min-h-[28rem] を持たせる。
  // これが無いと、高さが足りないときに min-h-0 のこのペインだけが縮められ、
  // 見出しだけを残して中身が潰れる。lg 以上は grid の列なので min-h-0 に戻す。
  return (
    <aside
      id="jev-console-body"
      className="flex min-h-[28rem] shrink-0 flex-col border-t border-black/10 lg:h-full lg:w-[27rem] lg:min-h-0 lg:border-l lg:border-t-0 dark:border-white/15"
    >
      <div className="flex items-start justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="min-w-0">
          <h2 className="font-medium">Jev コンソール</h2>
          <p className="mt-0.5 text-xs tabular-nums text-zinc-500">
            {calls} 回 · 入力 {inTok.toLocaleString()} / 出力 {outTok.toLocaleString()} トークン · 平均{" "}
            {avgMs}ms{failed > 0 ? ` · 失敗 ${failed}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded
          aria-controls="jev-console-body"
          title="Jev コンソールを畳む"
          aria-label="Jev コンソールを畳む"
          className="shrink-0 rounded-md p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          {/* 右側のパネルを閉じるアイコン（枠の右に仕切りと、右向きの山形） */}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M15 4v16" />
            <path d="M8.5 9.5 11 12l-2.5 2.5" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            Jev に送った質問と、返ってきた確率がここに残ります。
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {[...entries].reverse().map((e, i) => {
              const v = e.interpretation ? VERDICT_LABEL[e.interpretation.verdict] : null;
              return (
                <li
                  key={e.id}
                  className="rounded-md border border-black/10 p-2 text-sm dark:border-white/15"
                >
                  <details open={i === 0} className="group">
                    <summary className="list-none cursor-pointer [&::-webkit-details-marker]:hidden">
                      <DisclosureIcon className="mr-1" />
                      <span className="mr-2 tabular-nums text-xs text-zinc-500">{e.at}</span>
                      {v && (
                        <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${v.cls}`}>{v.label}</span>
                      )}
                      {e.kind && (
                        <span className="mr-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-300">
                          {e.kind === "scope" ? "業務の変化" : "問いかけ"}
                        </span>
                      )}
                      {e.error && (
                        <span className="mr-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-500/20 dark:text-red-300">
                          エラー
                        </span>
                      )}
                      <span className="break-words">{e.utterance}</span>
                      {e.exchange && (
                        <span className="ml-2 text-xs tabular-nums text-zinc-400">
                          {Object.keys(e.exchange.request.questions).length}問 / {e.exchange.elapsedMs}ms
                        </span>
                      )}
                    </summary>
                    {e.error && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">{e.error}</p>
                    )}
                    {e.interpretation && (
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                        {e.interpretation.summary}
                      </p>
                    )}
                    {e.note && (
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{e.note}</p>
                    )}
                    <EntryDetail entry={e} />
                    {!e.exchange && e.debug && <FailureDetail debug={e.debug} />}
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </aside>
  );
}
