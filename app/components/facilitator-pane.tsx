"use client";

import { ISSUE_KIND_LABEL } from "@/lib/model/labels";
import type { OpenIssue } from "@/lib/model/types";
import type { FacilitatorStatus } from "./use-facilitator";

type Props = {
  devMode?: boolean;
  /** いま参加者に出している問い（無ければ null） */
  asked: OpenIssue | null;
  status: FacilitatorStatus;
  auto: boolean;
  onAutoChange: (auto: boolean) => void;
  speakSupported: boolean;
  speakEnabled: boolean;
  onSpeakEnabledChange: (enabled: boolean) => void;
  speaking: boolean;
  onGenerate: () => void;
  onAnswered: (issueId: string) => void;
  onPark: (issueId: string) => void;
  /** 保留にして、別の問いを出す */
  onNext: (issueId: string) => void;
  onReplay: () => void;
};

/** ファシリテーター。「いま聞くべき 1 問」を 1 つだけ出す。 */
export function FacilitatorPane(p: Props) {
  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";
  const generating = p.status.kind === "generating";

  return (
    <section
      aria-label="ファシリテーター"
      className="flex flex-col gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="font-medium">ファシリテーター</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <label className="flex items-center gap-1.5" title="間が空いたときなどに、自動で問いを出します">
            <input type="checkbox" checked={p.auto} onChange={(e) => p.onAutoChange(e.target.checked)} />
            自動で問いかける
          </label>
          <label
            className="flex items-center gap-1.5"
            title={
              p.speakSupported
                ? "問いをブラウザ内蔵の音声で読み上げます（読み上げ中はマイクの入力を無視します）"
                : "このブラウザは読み上げに対応していません"
            }
          >
            <input
              type="checkbox"
              checked={p.speakEnabled}
              disabled={!p.speakSupported}
              onChange={(e) => p.onSpeakEnabledChange(e.target.checked)}
            />
            読み上げ
          </label>
        </div>
      </div>

      {p.asked?.prompt ? (
        <div className="rounded-md border border-violet-300 bg-violet-50 p-3 dark:border-violet-500/40 dark:bg-violet-500/10">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded bg-violet-200 px-1.5 text-xs leading-5 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100">
              {ISSUE_KIND_LABEL[p.asked.kind]}
            </span>
            <p className="min-w-0 break-words text-base font-medium">{p.asked.prompt.text}</p>
          </div>
          {p.asked.prompt.suggestedAnswer && (
            <p className="mt-2 break-words text-sm text-zinc-600 dark:text-zinc-400">
              <span className="text-zinc-500">推奨回答（仮）: </span>
              {p.asked.prompt.suggestedAnswer}
            </p>
          )}
          {p.devMode && (p.asked.ignored ?? 0) > 0 && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              答えないまま話が進みました（{p.asked.ignored}/2）。もう一度進むと保留にします。
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => p.onAnswered(p.asked!.id)}>
              答えた
            </button>
            <button type="button" className={btn} onClick={() => p.onPark(p.asked!.id)}>
              保留にする
            </button>
            <button type="button" className={btn} onClick={() => p.onNext(p.asked!.id)}>
              別の問いにする
            </button>
            <button type="button" className={btn} onClick={p.onReplay} disabled={!p.speakSupported}>
              {p.speaking ? "🔊 読み上げ中…" : "🔊 もう一度"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btn} onClick={p.onGenerate} disabled={generating}>
            {generating ? "考え中…" : "問いかけを出す"}
          </button>
          <p
            className={`min-w-0 break-words text-sm ${
              p.status.kind === "error"
                ? "text-red-600 dark:text-red-400"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
            role={p.status.kind === "error" ? "alert" : undefined}
          >
            {p.status.message}
          </p>
        </div>
      )}
    </section>
  );
}
