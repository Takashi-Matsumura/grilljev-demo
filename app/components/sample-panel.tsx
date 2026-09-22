"use client";

export type SampleMode = "script" | "jev";

type Props = {
  cursor: number;
  total: number;
  playing: boolean;
  mode: SampleMode;
  onModeChange: (mode: SampleMode) => void;
  topic: "loan" | "app";
  onTopicChange: (topic: "loan" | "app") => void;
  /** 台本の最後に「話題が別の業務へ移る場面」を足すか */
  withShift: boolean;
  onWithShiftChange: (on: boolean) => void;
  onTogglePlay: () => void;
  onNext: () => void;
};

/** 開発用。マイクなしで、台本の文字起こしを流して図を育てる。 */
export function SamplePanel({
  cursor,
  total,
  playing,
  mode,
  onModeChange,
  topic,
  onTopicChange,
  withShift,
  onWithShiftChange,
  onTogglePlay,
  onNext,
}: Props) {
  const finished = cursor >= total;
  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";
  const seg = (m: SampleMode, label: string) => (
    <button
      type="button"
      onClick={() => onModeChange(m)}
      aria-pressed={mode === m}
      className={`px-3 py-1.5 text-sm ${
        mode === m ? "bg-foreground text-background" : "hover:bg-black/5 dark:hover:bg-white/10"
      }`}
    >
      {label}
    </button>
  );

  return (
    <details open className="border-t border-black/10 px-4 py-3 dark:border-white/15">
      <summary className="cursor-pointer text-sm font-medium">開発用サンプル</summary>
      <div className="mt-3 flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          題材
          <select
            value={topic}
            onChange={(e) => onTopicChange(e.target.value as "loan" | "app")}
            className="rounded-md border border-black/15 bg-transparent px-2 py-1 dark:border-white/20"
          >
            <option value="loan">与信照会つき見積作成</option>
            <option value="app">このアプリの仕組み（Jev 専用）</option>
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">判定方法</span>
          <div className="flex overflow-hidden rounded-md border border-black/15 dark:border-white/20">
            {topic === "loan" && seg("script", "台本（固定）")}
            {seg("jev", "Jev")}
          </div>
        </div>
        <p className="text-xs text-zinc-500">
          {mode === "script"
            ? "台本に固定で書いた変更を図に反映します（Jev は呼びません。課金なし）。"
            : "1 行ごとに Jev を 1 回呼んで判定します（外部 API・課金あり）。ステップ名・新しい登場人物・分岐の条件文はローカルの gemma が作り、次の発話で Jev が検証します。台本の想定と一致したかを各行に表示します。"}
        </p>
        <label className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            className="mt-1"
            checked={withShift}
            onChange={(e) => onWithShiftChange(e.target.checked)}
          />
          <span>
            最後に「話題が請求書発行の話へ移る場面」を足す
            <span className="block text-xs text-zinc-500">
              対象業務の変化の検知を試す用。Jev モードでだけ検知します（台本モードでは図は変わりません）。
            </span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onTogglePlay} disabled={finished} className={btn}>
            {playing && !finished ? "❚❚ 一時停止" : "▶ 自動再生"}
          </button>
          <button type="button" onClick={onNext} disabled={finished} className={btn}>
            次の1行
          </button>
          <span className="text-sm tabular-nums text-zinc-500">
            {cursor} / {total}
            {finished ? "（終了）" : ""}
          </span>
        </div>
        <p className="text-xs text-zinc-500">
          会議をやり直すには、画面上部の「会議をやり直す」を使います。
        </p>
      </div>
    </details>
  );
}
