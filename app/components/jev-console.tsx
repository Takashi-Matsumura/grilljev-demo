"use client";

import { useState } from "react";
import type { Interpretation, Verdict } from "@/lib/analysis/interpret";
import type { JevAnswer, JevExchange } from "@/lib/jev";

/** 1 回の jev 呼び出しの記録。送った内容・返ってきた内容は組み立て直さず、そのまま持つ。 */
export type ConsoleEntry = {
  id: string;
  at: string;
  /** 見出しに出す文。発話の判定なら発話、それ以外なら何の呼び出しか */
  utterance: string;
  exchange?: JevExchange<object>;
  interpretation?: Interpretation;
  error?: string;
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
    return (
      <aside className="border-t border-black/10 lg:h-full lg:border-l lg:border-t-0 dark:border-white/15">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="jev-console-body"
          title="jev コンソールを開く"
          className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-black/5 lg:h-full lg:w-12 lg:flex-col lg:px-0 dark:hover:bg-white/10"
        >
          <span aria-hidden>◀</span>
          <span className="font-medium lg:[writing-mode:vertical-rl]">jev コンソール</span>
          <span className="text-xs tabular-nums text-zinc-500 lg:[writing-mode:vertical-rl]">
            {calls} 回{failed > 0 ? ` · 失敗 ${failed}` : ""}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="jev-console-body"
      className="flex min-h-0 flex-col border-t border-black/10 lg:h-full lg:w-[27rem] lg:border-l lg:border-t-0 dark:border-white/15"
    >
      <div className="flex items-start justify-between gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15">
        <div className="min-w-0">
          <h2 className="font-medium">jev コンソール</h2>
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
          title="jev コンソールを畳む"
          className="shrink-0 rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        >
          畳む ▶
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <p className="text-sm text-zinc-500">
            jev に送った質問と、返ってきた確率がここに残ります。
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
                  <details open={i === 0}>
                    <summary className="cursor-pointer">
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
