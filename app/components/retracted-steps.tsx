"use client";

import { useEffect, useState } from "react";
import type { FlowModel, ModelOp, Step } from "@/lib/model/types";
import { DisclosureIcon } from "./disclosure-icon";

/** 取り消された（削除された）ステップ。新しく取り消したものほど前に並べる */
const retracted = (model: FlowModel): Step[] =>
  model.steps.filter((s) => s.status === "retracted").sort((a, b) => b.order - a.order);

const restoreBtn =
  "shrink-0 rounded-md border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";

/**
 * 図の下段の「削除したステップ」。マウス・音声の訂正・要対応の却下で消したステップを、
 * あとからでも元に戻せるようにする。戻すと元の位置（order）と、消す前の確定/仮に戻る。
 */
export function RetractedSteps({ model, onCommit }: { model: FlowModel; onCommit: (ops: ModelOp[]) => void }) {
  const steps = retracted(model);
  if (steps.length === 0) return null;
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 [&::-webkit-details-marker]:hidden dark:border-white/20 dark:hover:bg-white/10">
        <DisclosureIcon />
        削除したステップ
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300">
          {steps.length}
        </span>
      </summary>
      <ul className="absolute bottom-full left-0 z-10 mb-1 flex w-[min(30rem,calc(100vw-2rem))] max-h-[min(60vh,22rem)] flex-col gap-1 overflow-y-auto rounded-md border border-black/15 bg-background p-2 shadow-lg dark:border-white/20">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{s.label}</span>
              <span className="block text-xs text-zinc-500">
                {nameOf(s.from)} → {nameOf(s.to)}
              </span>
            </span>
            <button type="button" className={restoreBtn} onClick={() => onCommit([{ op: "step.restore", id: s.id }])}>
              元に戻す
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** 削除の知らせを出している時間。過ぎたら消える（「削除したステップ」からは、いつでも戻せる） */
const NOTICE_MS = 10_000;

/**
 * ステップが消えた直後に「◯◯を削除しました［元に戻す］」を出す。消した経路（マウス・音声の訂正・
 * 要対応の却下）を問わず、モデルの変化から検知する。開いた時点ですでに消えていたものは出さない。
 */
export function RetractNotice({ model, onCommit }: { model: FlowModel; onCommit: (ops: ModelOp[]) => void }) {
  const ids = model.steps.filter((s) => s.status === "retracted").map((s) => s.id);
  const key = ids.join(",");
  // 前回見た「消えているステップ」。変化をレンダー中に検知する（effect で setState しない作法）
  const [seen, setSeen] = useState(key);
  const [notice, setNotice] = useState<Step[]>([]);
  if (key !== seen) {
    const before = new Set(seen.split(","));
    const fresh = model.steps.filter((s) => s.status === "retracted" && !before.has(s.id));
    setSeen(key);
    setNotice(fresh);
  }
  useEffect(() => {
    if (notice.length === 0) return;
    const t = setTimeout(() => setNotice([]), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // 戻された・別の経路で状態が変わったものは、知らせから外す
  const shown = notice.filter((n) => model.steps.find((s) => s.id === n.id)?.status === "retracted");
  if (shown.length === 0) return null;
  const text =
    shown.length === 1 ? `「${shown[0].label}」を削除しました` : `${shown.length} 件のステップを削除しました`;
  return (
    <div
      role="status"
      className="absolute inset-x-6 bottom-6 z-20 mx-auto flex w-fit max-w-full items-center gap-3 rounded-lg border border-black/15 bg-background px-3 py-2 text-sm shadow-lg dark:border-white/20"
    >
      <span className="min-w-0 truncate">{text}</span>
      <button
        type="button"
        className={`${restoreBtn} border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300`}
        onClick={() => {
          onCommit(shown.map((s) => ({ op: "step.restore", id: s.id })));
          setNotice([]);
        }}
      >
        元に戻す
      </button>
      <button
        type="button"
        aria-label="閉じる"
        className="shrink-0 rounded px-1 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
        onClick={() => setNotice([])}
      >
        ×
      </button>
    </div>
  );
}
