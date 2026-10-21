"use client";

import { useState } from "react";
import { MAX_SEED_ACTORS } from "@/lib/store/session-types";
import type { ActorCandidate } from "@/lib/suggest/actors";
import { newStakeholderRow, type StakeholderRow } from "./stakeholder-editor";

const KIND_LABEL: Record<ActorCandidate["kind"], string> = {
  role: "部署・役職",
  person: "個人",
  system: "システム",
  external: "社外",
};

/**
 * 業務名から、抜けていそうな登場人物の候補を AI に出させる（開始画面）。
 * 候補はたたき台。自動では足さず、押したものだけを登場人物に加える。
 */
export function ActorSuggestions({
  title,
  rows,
  onChange,
}: {
  title: string;
  rows: StakeholderRow[];
  onChange: (rows: StakeholderRow[]) => void;
}) {
  const [candidates, setCandidates] = useState<ActorCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/suggest-actors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, known: rows.map((r) => r.name).filter((n) => n.trim() !== "") }),
      });
      const data = (await res.json().catch(() => ({}))) as { candidates?: ActorCandidate[]; error?: string };
      if (!res.ok || !data.candidates) throw new Error(data.error ?? "候補を出せませんでした");
      setCandidates(data.candidates);
    } catch (e) {
      setError(e instanceof Error ? e.message : "候補を出せませんでした");
    } finally {
      setBusy(false);
    }
  }

  const names = new Set(rows.map((r) => r.name));
  // 採用した候補は一覧から消す（同じ名前を手で足した場合も）
  const shown = (candidates ?? []).filter((c) => !names.has(c.name));
  const full = rows.length >= MAX_SEED_ACTORS;
  const noTitle = title.trim() === "";

  // 登場人物のレーンの下端に収まる 1 行。候補は点線のチップで、押すとレーンの末尾に加わる
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {candidates ? (
          <>
            <span className="text-xs text-zinc-500" title="AI の推測です。この業務に実際に関わる人だけを選んでください">
              AI の候補
            </span>
            {shown.length > 0 ? (
              <ul className="contents" aria-label="登場人物の候補">
                {shown.map((c) => (
                  <li key={c.name}>
                    <button
                      type="button"
                      disabled={full}
                      className="rounded-full border border-dashed border-black/30 bg-background px-2.5 py-1 text-xs hover:border-solid hover:bg-black/5 disabled:opacity-50 dark:border-white/30 dark:hover:bg-white/10"
                      title={`${KIND_LABEL[c.kind]}${c.why ? `・${c.why}` : ""}`}
                      aria-label={`${c.name}（${KIND_LABEL[c.kind]}）を登場人物に加える`}
                      onClick={() => onChange([...rows, newStakeholderRow(c.name, c.kind)])}
                    >
                      <span aria-hidden>＋ </span>
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              !busy && <span className="text-xs text-zinc-500">追加できる候補はありません</span>
            )}
            <button
              type="button"
              className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/10"
              disabled={busy || noTitle}
              aria-label="候補を出し直す"
              title="候補を出し直す"
              onClick={() => void load()}
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={busy ? "animate-spin" : ""}
              >
                <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-full border border-black/15 bg-background px-3 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10"
            disabled={busy || noTitle}
            onClick={() => void load()}
            title={noTitle ? "先に業務名を入力してください" : "業務名から、抜けていそうな登場人物を AI が挙げます"}
          >
            {busy ? "候補を考えています…" : "AI に候補を出してもらう"}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}
    </div>
  );
}
