"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MermaidDiagram } from "@/app/components/mermaid-diagram";
import type { FlowModel } from "@/lib/model/types";
import { buildScenes, narrate, type Narration, type Scene } from "@/lib/preview/scenes";
import { toMermaid } from "@/lib/render/mermaid";

/** 1 場面を見せる時間（ミリ秒）。字幕が長いほど長く、ステップは矢印の丸が走る分を足す */
function durationOf(scene: Scene): number {
  return 2_200 + 110 * scene.caption.length + (scene.kind === "step" ? 900 : 0);
}

const SPEEDS = [
  { value: 0.6, label: "ゆっくり" },
  { value: 1, label: "ふつう" },
  { value: 1.6, label: "はやい" },
] as const;

type Ai = { status: "loading" } | { status: "ready"; narration: Narration } | { status: "error"; message: string };

/**
 * フローのプレビュー。起点から終点まで、図の上で今の手順を強調しながら、字幕で流れを言葉にする。
 * 作ったチームで「この流れで合っているか」を一緒に確かめるためのもの。図は変えない。
 *
 * 字幕はまずコードで作ったもの（lib/preview/scenes.ts）で流し始め、gemma の言い回しが届いたら差し替える。
 * gemma が落ちていても、再生はそのまま続けられる。
 */
export function FlowPlayer({ name, model, onClose }: { name: string; model: FlowModel; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const code = useMemo(() => toMermaid(model), [model]);
  const base = useMemo(() => buildScenes(model, name), [model, name]);
  const [ai, setAi] = useState<Ai>({ status: "loading" });
  const [useAi, setUseAi] = useState(true);
  const scenes = useMemo(
    () => narrate(base, useAi && ai.status === "ready" ? ai.narration : null),
    [base, useAi, ai],
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = scenes.length - 1;
  const scene = scenes[Math.min(index, last)];

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/narrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, title: name }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { narration?: Narration; error?: string };
        setAi(
          res.ok && json.narration
            ? { status: "ready", narration: json.narration }
            : { status: "error", message: json.error ?? `HTTP ${res.status}` },
        );
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) setAi({ status: "error", message: e instanceof Error ? e.message : "通信に失敗しました" });
      });
    return () => ctrl.abort();
  }, [model, name]);

  // 再生中は、場面の時間が過ぎたら次へ。最後の場面で止まる
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (index >= last) setPlaying(false);
      else setIndex(index + 1);
    }, durationOf(scene) / speed);
    return () => clearTimeout(timer);
  }, [playing, index, last, scene, speed]);

  const go = useCallback(
    (i: number) => setIndex(Math.max(0, Math.min(last, i))),
    [last],
  );
  const togglePlay = useCallback(() => {
    // 最後まで見終えたあとの再生は、最初から
    if (!playing && index >= last) setIndex(0);
    setPlaying(!playing);
  }, [playing, index, last]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (e.target as HTMLElement | null)?.tagName === "SELECT") return;
      if (e.key === " ") togglePlay();
      else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "Home") go(0);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, go, index]);

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
  const narrated = scene.kind === "step" && scene.label && scene.caption !== scene.label;

  return (
    <dialog
      ref={dialogRef}
      aria-label={`${name} の流れのプレビュー`}
      // Esc で閉じる（dialog の標準動作を、親の状態に揃える）
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2 dark:border-white/15">
          <h2 className="truncate text-lg font-semibold">
            <span className="mr-2 text-sm font-normal text-zinc-500">流れを確認</span>
            {name}
          </h2>
          <button type="button" className={btn} onClick={onClose} title="閉じる（Esc）">
            閉じる
          </button>
        </header>

        <div className="flow-play min-h-0 flex-1 p-4">
          <MermaidDiagram code={code} play={scene.mark} />
        </div>

        <section
          aria-live="polite"
          className="shrink-0 border-t border-black/10 bg-zinc-50 px-6 pb-4 pt-3 dark:border-white/15 dark:bg-zinc-900"
        >
          {/* 場面ごとの目盛り。押すとその場面へ */}
          <div className="mb-3 flex gap-1" role="group" aria-label="場面">
            {scenes.map((s, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${i + 1} 番目の場面へ`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => go(i)}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i < index
                    ? "bg-sky-600/60 dark:bg-sky-400/60"
                    : i === index
                      ? "bg-sky-600 dark:bg-sky-400"
                      : s.kind === "step"
                        ? "bg-black/15 dark:bg-white/20"
                        : "bg-black/5 dark:bg-white/10"
                }`}
              />
            ))}
          </div>

          <div key={index} className="min-h-[6.5rem] animate-caption-in motion-reduce:animate-none">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              {scene.number !== undefined && (
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-zinc-800 px-1.5 text-xs font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900">
                  {scene.number}
                </span>
              )}
              <span className="font-semibold text-zinc-800 dark:text-zinc-200">{scene.heading}</span>
              {scene.context && (
                <span className="rounded-full border border-violet-300 bg-violet-50 px-2 text-xs text-violet-800 dark:border-violet-400/40 dark:bg-violet-400/10 dark:text-violet-200">
                  {scene.context}
                </span>
              )}
              {scene.badges.map((b) => (
                <span key={b} className="rounded border border-black/10 px-1.5 text-xs dark:border-white/15">
                  {b}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xl leading-relaxed sm:text-2xl">{scene.caption}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              {scene.artifact && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200">
                  渡すもの: {scene.artifact}
                </span>
              )}
              {narrated && <span>図の表記: {scene.label}</span>}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={() => go(0)} title="最初から（Home）">
              ⏮ 最初から
            </button>
            <button type="button" className={btn} disabled={index === 0} onClick={() => go(index - 1)} title="前へ（←）">
              ◀ 前へ
            </button>
            <button
              type="button"
              className={`${btn} min-w-24 border-sky-600 bg-sky-600 text-white hover:bg-sky-700 dark:border-sky-500 dark:bg-sky-500 dark:hover:bg-sky-600`}
              onClick={togglePlay}
              title="再生・一時停止（Space）"
            >
              {playing ? "⏸ 一時停止" : index >= last ? "↻ もう一度" : "▶ 再生"}
            </button>
            <button type="button" className={btn} disabled={index >= last} onClick={() => go(index + 1)} title="次へ（→）">
              次へ ▶
            </button>
            <span className="ml-2 text-sm tabular-nums text-zinc-500">
              {index + 1} / {scenes.length}
            </span>
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400">
              速さ
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              >
                {SPEEDS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400"
              title={ai.status === "error" ? ai.message : "ローカル AI が、図の内容を自然な文に言い換えます"}
            >
              <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
              AI の言い回し
              <span className="text-xs text-zinc-500">
                {ai.status === "loading" ? "（準備中…）" : ai.status === "error" ? "（使えません）" : ""}
              </span>
            </label>
          </div>
        </section>
      </div>
    </dialog>
  );
}
