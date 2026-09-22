"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Health } from "@/lib/health";

const POLL_MS = 10_000;

type Row = { key: string; label: string; ok: boolean; detail: string };

function toRows(h: Health): Row[] {
  const llamaDetail = h.llama.ok
    ? [h.llama.model, h.llama.nCtx ? `ctx ${h.llama.nCtx}` : null].filter(Boolean).join(" · ")
    : h.llama.detail;
  return [
    { key: "whisper", label: "whisper（文字起こし）", ok: h.whisper.ok, detail: h.whisper.detail },
    { key: "llama", label: "llama（gemma）", ok: h.llama.ok, detail: llamaDetail },
    { key: "jev", label: "Jev", ok: h.jev.ok, detail: h.jev.detail },
  ];
}

/** ヘッダー用のアイコンボタン。押すとバックエンドの状態をダイアログで出す。 */
export function HealthButton({ initial }: { initial: Health }) {
  const [health, setHealth] = useState<Health>(initial);
  const [stale, setStale] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth((await res.json()) as Health);
      setStale(false);
    } catch {
      // アプリ自体に届かない。直前の表示を「古い」として残す
      setStale(true);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const rows = toRows(health);
  const allOk = rows.every((r) => r.ok);
  const dot = stale ? "bg-zinc-400" : allOk ? "bg-emerald-500" : "bg-red-500";
  const summary = stale
    ? "状態を取得できません"
    : allOk
      ? "バックエンドは正常"
      : "バックエンドに問題があります";

  const open = () => {
    dialogRef.current?.showModal();
    void refresh(); // 開いた瞬間の状態を見せる
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={`バックエンドの状態: ${summary}`}
        title={summary}
        className="relative rounded-md p-2 text-zinc-600 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
      >
        {/* 心拍（状態）アイコン */}
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
        <span
          aria-hidden
          className={`absolute right-1 top-1 h-2.5 w-2.5 rounded-full ring-2 ring-background ${dot}`}
        />
      </button>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          // ダイアログ外（::backdrop）をクリックしたら閉じる
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-black/10 bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40 dark:border-white/15"
      >
        <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/15">
          <h2 className="font-medium">バックエンドの状態</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="閉じる"
            className="rounded-md px-2 py-1 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        </div>
        <ul className="flex flex-col gap-2 p-4">
          {rows.map((r) => (
            <li
              key={r.key}
              className="flex items-baseline gap-3 rounded-md border border-black/10 px-3 py-2 dark:border-white/15"
            >
              <span
                aria-hidden
                className={`inline-block h-2.5 w-2.5 shrink-0 translate-y-px rounded-full ${
                  stale ? "bg-zinc-400" : r.ok ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <div className="min-w-0">
                <div className="font-medium">{r.label}</div>
                <div className="break-words text-sm text-zinc-600 dark:text-zinc-400">
                  {r.ok ? "OK" : "NG"} — {r.detail}
                </div>
              </div>
            </li>
          ))}
          {stale && (
            <li className="text-sm text-zinc-500">
              アプリに接続できません。表示は最後に取得した状態です。
            </li>
          )}
        </ul>
        <p className="border-t border-black/10 px-4 py-3 text-xs text-zinc-500 dark:border-white/15">
          Jev は課金される外部 API のため、ここではキーの有無だけを確認します（実際の疎通は未確認）。
        </p>
      </dialog>
    </>
  );
}
