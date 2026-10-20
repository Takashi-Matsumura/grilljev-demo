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
  const btn =
    "rounded-md border border-black/15 px-2.5 py-1 text-xs hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn}
          disabled={busy || title.trim() === ""}
          onClick={() => void load()}
          title={title.trim() === "" ? "先に業務名を入力してください" : "業務名から、抜けていそうな登場人物を AI が挙げます"}
        >
          {busy ? "候補を考えています…" : candidates ? "候補を出し直す" : "AI に候補を出してもらう"}
        </button>
        {candidates && (
          <span className="text-xs text-zinc-500">AI の推測です。この業務に実際に関わる人だけを選んでください。</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
          {error}
        </p>
      )}
      {candidates && shown.length === 0 && !busy && (
        <p className="text-xs text-zinc-500">追加できる候補はありません。</p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="登場人物の候補">
          {shown.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                disabled={full}
                className="flex items-baseline gap-1.5 rounded-md border border-dashed border-black/25 px-2 py-1 text-left text-xs hover:border-solid hover:bg-black/5 disabled:opacity-50 dark:border-white/30 dark:hover:bg-white/10"
                title={`${c.name} を登場人物に加える`}
                onClick={() => onChange([...rows, newStakeholderRow(c.name, c.kind)])}
              >
                <span aria-hidden>＋</span>
                <span className="font-medium">{c.name}</span>
                <span className="text-zinc-500">
                  {KIND_LABEL[c.kind]}
                  {c.why && `・${c.why}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
