"use client";

import { DisclosureIcon } from "./disclosure-icon";

type Props = {
  cursor: number;
  total: number;
  playing: boolean;
  topic: "loan" | "app";
  onTopicChange: (topic: "loan" | "app") => void;
  onTogglePlay: () => void;
  onNext: () => void;
  /** 題材が前提にしている登場人物のうち、まだ図にいないもの */
  missingActors: string[];
  /** 足りない登場人物を図に足す */
  onAddActors: () => void;
};

/**
 * 開発・デモ用。マイクなしで、台本の文字起こしを Jev に流して図を育てる。
 * 判定は常に Jev で行う（固定の変更をそのまま流す「台本」モードは廃止）。
 */
export function SamplePanel({
  cursor,
  total,
  playing,
  topic,
  onTopicChange,
  onTogglePlay,
  onNext,
  missingActors,
  onAddActors,
}: Props) {
  const finished = cursor >= total;
  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";

  return (
    <details open className="group border-t border-black/10 px-4 py-3 dark:border-white/15">
      <summary className="flex list-none cursor-pointer items-center gap-1.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <DisclosureIcon />
        開発用サンプル
      </summary>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          題材
          <select
            value={topic}
            onChange={(e) => onTopicChange(e.target.value as "loan" | "app")}
            className="rounded-md border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
          >
            <option value="loan">与信照会つき見積作成</option>
            <option value="app">このアプリの仕組み（判定器で実行）</option>
          </select>
        </label>
      </div>
      {missingActors.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            図にいない登場人物があります: {missingActors.join("、")}
          </p>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
            このまま流すと、既存ステップの重複と判定されて図に入らないことがあります。
            会議を作るときに関係部署へ入れておくのが本来の手順です。
          </p>
          <button
            type="button"
            onClick={onAddActors}
            className="mt-2 rounded-md border border-amber-400 px-3 py-1.5 text-sm hover:bg-amber-100 dark:border-amber-500/60 dark:hover:bg-amber-500/20"
          >
            {missingActors.length} 者を図に追加
          </button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onTogglePlay} disabled={finished} className={btn}>
          {playing && !finished ? "❚❚ 一時停止" : "▶ 自動再生"}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={finished}
          title="台本を 1 行だけ進めて、判定器の結果を確認する"
          className={btn}
        >
          ⏭ ステップ実行
        </button>
        <span className="text-sm tabular-nums text-zinc-500">
          {cursor} / {total}
          {finished ? "（終了）" : ""}
        </span>
      </div>
    </details>
  );
}
