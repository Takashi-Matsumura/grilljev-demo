"use client";

import { useEffect, useState } from "react";
import type { ReadinessItem } from "@/lib/model/attention";
import { isAbsent } from "@/lib/facilitator/stakeholders";
import type { Actor, FlowModel, ModelOp } from "@/lib/model/types";
import { ActorEditDialog } from "./actor-edit-dialog";
import type { UpdateSource } from "./diagram-pane";
import { useFacilitatorAuto } from "./use-facilitator-auto";

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

const ACTOR_CHIP = "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";

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
 * 会議の前に登録した登場人物の要点。起点・終点と、会議に出席していない登場人物を出す。
 * 出席していない人の作業は会話からは推測しかできないので、図を読むときの注意として常に見せる。
 */
function ActorChips({ actors }: { actors: Actor[] }) {
  const ordered = [...actors].sort((a, b) => a.lane - b.lane);
  const trigger = ordered.find((a) => a.role === "trigger");
  const end = ordered.find((a) => a.role === "end");
  const absent = ordered.filter(isAbsent);
  return (
    <>
      {trigger && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${ACTOR_CHIP}`} title="この業務を始める登場人物">
          起点: {trigger.name}
        </span>
      )}
      {end && (
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${ACTOR_CHIP}`} title="最終的な成果を受け取る登場人物">
          終点: {end.name}
        </span>
      )}
      {absent.length > 0 && (
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${READINESS_BADGE.missing}`}
          title="会議に出席していない登場人物です。この人の作業は、会話からの推測なので確認が必要です"
        >
          出席なし: {absent.map((a) => a.name).join("、")}
        </span>
      )}
    </>
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
  onEditActors,
  devMode = false,
}: {
  model: FlowModel;
  readiness: ReadinessItem[];
  source: UpdateSource;
  /** 登場人物の手直し（過去の図では渡さない） */
  onEditActors?: (ops: ModelOp[]) => void;
  devMode?: boolean;
}) {
  const badge = (devMode ? SOURCE_BADGE_DEV : SOURCE_BADGE_PLAIN)[source];
  // バックエンドの状態ダイアログのトグルと共有（別の React ツリーなので、ここでも直接読む）
  const [facilitatorAuto] = useFacilitatorAuto();

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
    <div className="flex shrink-0 items-center gap-3 border-b border-black/10 px-4 py-2 dark:border-white/15">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="flex min-w-0 flex-1 items-baseline gap-3">
            <h2 className="shrink-0 font-medium" title={`対象業務: ${model.scope.title || "（未設定）"}`}>
              業務フロー図
            </h2>
            {facilitatorAuto && (
              <span
                className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-500/20 dark:text-violet-300"
                title="自動問いかけが ON です。問いが出ると、この図の上に浮かせて出します"
              >
                ファシリテーター
              </span>
            )}
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
          <ActorChips actors={model.actors} />
        </div>
      </div>
      {/* 登場人物の編集は、バッジ（状態の表示）とは別物の「操作」なので、右端に丸いボタンで置く */}
      {onEditActors && <ActorEditDialog model={model} onSave={onEditActors} />}
    </div>
  );
}
