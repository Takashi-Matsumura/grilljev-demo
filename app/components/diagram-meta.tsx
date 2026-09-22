"use client";

import { useEffect, useState } from "react";
import type { ReadinessItem } from "@/lib/model/attention";
import type { FlowModel } from "@/lib/model/types";
import type { UpdateSource } from "./diagram-pane";

/** 更新の合図を出している時間。これを過ぎると自然に消える。 */
const UPDATE_FLASH_MS = 6_000;

/** 開発者モード: 何によって更新されたかの内訳。本番向けは、更新があったかどうかだけ伝える。 */
const SOURCE_BADGE_DEV: Record<UpdateSource, { text: string; cls: string }> = {
  none: {
    text: "更新なし",
    cls: "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300",
  },
  jev: {
    text: "直近の更新: Jev の判定",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  },
  manual: {
    text: "直近の更新: 手動操作",
    cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  },
};

const SOURCE_BADGE_PLAIN: Record<UpdateSource, { text: string; cls: string }> = {
  none: SOURCE_BADGE_DEV.none,
  jev: { text: "更新あり", cls: SOURCE_BADGE_DEV.jev.cls },
  manual: { text: "更新あり", cls: SOURCE_BADGE_DEV.manual.cls },
};

const READINESS_BADGE = {
  filled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  missing: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
};

function ReadinessChip({ item }: { item: ReadinessItem }) {
  const filled = item.value !== "";
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${filled ? READINESS_BADGE.filled : READINESS_BADGE.missing}`}
      title={filled ? item.value : item.hint}
    >
      {item.label}
      {!filled && "未"}
    </span>
  );
}

/**
 * 業務フロー図の上段メタ行。見出し・目的・共通認識の充足度・更新バッジをまとめる。
 * 「対象業務」名はページヘッダーと DiagramTabs（現在タブ）に既に出ているので、
 * ここでは再掲せず h2 の title 属性に流す（タブが 0 件のときの手がかりとして残す）。
 */
export function DiagramMeta({
  model,
  readiness,
  source,
  devMode = false,
}: {
  model: FlowModel;
  readiness: ReadinessItem[];
  source: UpdateSource;
  devMode?: boolean;
}) {
  const badge = (devMode ? SOURCE_BADGE_DEV : SOURCE_BADGE_PLAIN)[source];

  // rev が変わるたびに「更新の合図」を一定時間だけ出す。本番モードでは
  // 常時表示せず、更新の瞬間だけ光らせて数秒で消す（レイアウトは動かさない）。
  // rev の変化はレンダー中に検知する（React の「レンダー中に state を調整する」作法。
  // 初回描画は必ず「変化なし」から始まるので、再開時に誤って光らない）。
  const [flash, setFlash] = useState(false);
  const [seenRev, setSeenRev] = useState(model.rev);
  if (model.rev !== seenRev) {
    setSeenRev(model.rev);
    setFlash(source !== "none");
  }
  // 消すタイマーは effect で持つ。rev が続けて変わっている間は、そのたびにやり直す。
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(false), UPDATE_FLASH_MS);
    return () => clearTimeout(t);
  }, [flash, model.rev]);
  const showBadge = devMode || flash;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-black/10 px-4 py-2 dark:border-white/15">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h2 className="shrink-0 font-medium" title={`対象業務: ${model.scope.title || "（未設定）"}`}>
            業務フロー図
          </h2>
          <p
            className="min-w-0 flex-1 truncate text-sm text-zinc-500 dark:text-zinc-400"
            title={model.scope.purpose || "目的はまだ確定していません"}
          >
            目的: {model.scope.purpose || <span className="text-zinc-400">（未確定）</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {devMode && <span className="text-xs tabular-nums text-zinc-400">rev.{model.rev}</span>}
          <span
            role="status"
            aria-hidden={!showBadge}
            className={`rounded px-2 py-0.5 text-xs transition-opacity ${badge.cls} ${
              showBadge ? "opacity-100" : "opacity-0"
            }`}
          >
            {badge.text}
          </span>
        </div>
      </div>
      <div aria-label="共通認識の充足度" className="flex flex-wrap items-center gap-1.5">
        {readiness.map((item) => (
          <ReadinessChip key={item.key} item={item} />
        ))}
      </div>
    </div>
  );
}
