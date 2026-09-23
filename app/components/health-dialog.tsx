"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Health } from "@/lib/health";
import { JEV_BACKENDS, JEV_BACKEND_LABELS, type JevBackend } from "@/lib/jev-backend";
import { ToggleSwitch } from "./toggle-switch";
import { useDevMode } from "./use-dev-mode";
import { useFacilitatorAuto } from "./use-facilitator-auto";
import { useJevBackend } from "./use-jev-backend";

const POLL_MS = 10_000;

type Row = { key: string; label: string; ok: boolean; detail: string };

const JEV_BACKEND_HINTS: Record<JevBackend, string> = {
  typesafe: "外部 API・課金。確率は Jev が出す",
  local: "外部に送らない。確率はモデルの自己申告",
};

function toRows(h: Health, backend: JevBackend): Row[] {
  const llamaDetail = h.llama.ok
    ? [h.llama.model, h.llama.nCtx ? `ctx ${h.llama.nCtx}` : null].filter(Boolean).join(" · ")
    : h.llama.detail;
  return [
    { key: "whisper", label: "whisper（文字起こし）", ok: h.whisper.ok, detail: h.whisper.detail },
    { key: "llama", label: "llama（gemma）", ok: h.llama.ok, detail: llamaDetail },
    {
      key: "jev",
      label: `判定器: ${JEV_BACKEND_LABELS[backend]}`,
      ok: h.jevBackends[backend].ok,
      detail: h.jevBackends[backend].detail,
    },
  ];
}

/** ヘッダー用のアイコンボタン。押すとバックエンドの状態をダイアログで出す。 */
export function HealthButton({ initial }: { initial: Health }) {
  const [health, setHealth] = useState<Health>(initial);
  const [stale, setStale] = useState(false);
  // Studio 側と同じキーを見る（`useDevMode` は同じブラウザ内なら自動で同期する）
  const [devMode] = useDevMode();
  // ファシリテーターの自動問いかけ。Studio とは別の React ツリーなので、同じ作法で共有する
  const [facilitatorAuto, setFacilitatorAuto] = useFacilitatorAuto();
  // 判定器の送り先。cookie に入り、以降の /api/analyze などがそれを読む
  const [jevBackend, setJevBackend] = useJevBackend(initial.jevBackend);
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

  // Jev はキーが設定されているときだけ選べる。疎通の OK/NG はキーの有無そのもの
  const selectable = (b: JevBackend) => b !== "typesafe" || health.jevBackends.typesafe.ok;

  // サーバが選べないものを弾いて別の判定器に回したら（キーを外した・古い cookie など）、画面もそれに合わせる
  useEffect(() => {
    if (!stale && health.jevBackend !== jevBackend) setJevBackend(health.jevBackend);
  }, [stale, health.jevBackend, jevBackend, setJevBackend]);

  const rows = toRows(health, jevBackend);
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
        <div className="flex items-center justify-between gap-3 border-b border-black/10 px-4 py-3 dark:border-white/15">
          <span className="font-medium">ファシリテーター</span>
          <ToggleSwitch
            checked={facilitatorAuto}
            onChange={setFacilitatorAuto}
            label="自動問いかけ"
            title="間が空いたときなどに、業務フロー図の上に問いを浮かせて出します"
          />
        </div>
        <div className="flex flex-col gap-2 border-b border-black/10 px-4 py-3 dark:border-white/15">
          <span className="font-medium">判定器</span>
          <div role="radiogroup" aria-label="判定器" className="grid grid-cols-2 gap-2">
            {JEV_BACKENDS.map((b) => {
              const selected = b === jevBackend;
              const status = health.jevBackends[b];
              const disabled = !selectable(b);
              return (
                <button
                  key={b}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  title={disabled ? status.detail : undefined}
                  onClick={() => {
                    setJevBackend(b);
                    void refresh();
                  }}
                  className={`flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left ${
                    selected
                      ? "border-sky-500 bg-sky-500/10"
                      : disabled
                        ? "cursor-not-allowed border-black/10 opacity-50 dark:border-white/15"
                        : "border-black/10 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span
                      aria-hidden
                      className={`inline-block h-2 w-2 rounded-full ${
                        stale ? "bg-zinc-400" : status.ok ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                    {JEV_BACKEND_LABELS[b]}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {disabled ? "API キーが未設定のため選べません（.env.local の TYPESAFE_API_KEY）" : JEV_BACKEND_HINTS[b]}
                  </span>
                </button>
              );
            })}
          </div>
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
                  {devMode ? (
                    <>
                      {r.ok ? "OK" : "NG"} — {r.detail}
                    </>
                  ) : r.ok ? (
                    "使えます"
                  ) : (
                    "使えません"
                  )}
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
        {devMode && jevBackend === "typesafe" && (
          <p className="border-t border-black/10 px-4 py-3 text-xs text-zinc-500 dark:border-white/15">
            Jev は課金される外部 API のため、ここではキーの有無だけを確認します（実際の疎通は未確認）。
          </p>
        )}
      </dialog>
    </>
  );
}
