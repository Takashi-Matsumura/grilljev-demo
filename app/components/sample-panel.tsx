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
};

/**
 * 開発・デモ用。マイクなしで、台本の文字起こしを Jev に流して図を育てる。
 * 判定は常に Jev で行う（固定の変更をそのまま流す「台本」モードは廃止）。
 */
export function SamplePanel({ cursor, total, playing, topic, onTopicChange, onTogglePlay, onNext }: Props) {
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
