"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { resampleTo16k, encodeWav } from "@/lib/audio/wav";
import { useRecorder } from "@/lib/audio/use-recorder";
import type { Segment } from "@/lib/audio/vad";
import type { JevBackend } from "@/lib/jev-backend";
import { clock, type Line, type LineAnalysis, type LineLabeling } from "@/lib/transcript/line";
import { combineVocab } from "@/lib/transcript/vocab";
import { ToggleSwitch } from "./toggle-switch";
import { useJevBackend } from "./use-jev-backend";
import { newId } from "@/lib/id";

type Pending = { id: string; blob: Blob };

const CHECK_TEXT: Record<string, { text: string; cls: string }> = {
  ok: { text: "検証OK", cls: "text-emerald-600 dark:text-emerald-400" },
  fallback: { text: "不忠実のため発話の先頭に戻した", cls: "text-amber-600 dark:text-amber-400" },
  relabel: { text: "不適切のため作り直し", cls: "text-amber-600 dark:text-amber-400" },
  merged: { text: "既存アクターの言い換えのため統合", cls: "text-amber-600 dark:text-amber-400" },
};

/**
 * gemma がステップ名・登場人物を作った結果と、次の発話での Jev の検証結果。
 *
 * 本番（devMode オフ）では控えめに: 生成中は小さな「⋯」だけ、できあがった後は何も出さない
 * （図に反映済みなので、この行での確認は要らない）。失敗だけは、何が起きたか分かるよう常に出す。
 */
function LabelingView({ labeling, devMode }: { labeling: LineLabeling; devMode: boolean }) {
  if (labeling.state === "pending") {
    return devMode ? (
      <span className="block pl-1 text-xs text-violet-500">
        ⋯ gemma: {labeling.note ?? "生成中"}
      </span>
    ) : (
      <span className="ml-2 text-xs text-zinc-400" title="名前を作成中">
        ⋯
      </span>
    );
  }
  if (labeling.state === "error") {
    return (
      <span className="block pl-1 text-xs text-red-600 dark:text-red-400">
        {devMode ? `gemma: ${labeling.error}` : `名前の作成でエラー: ${labeling.error}`}
      </span>
    );
  }
  if (!devMode) return null;
  const check = labeling.check ? CHECK_TEXT[labeling.check.outcome] : undefined;
  return (
    <span className="block pl-1 text-xs text-violet-600 dark:text-violet-400">
      gemma: ステップ名「{labeling.label}」
      {labeling.ms !== undefined && <span className="text-zinc-400"> ({labeling.ms}ms)</span>}
      {labeling.note && <span className="text-zinc-500"> · {labeling.note}</span>}
      {check ? (
        <span className={`ml-2 ${check.cls}`} title={labeling.check?.detail}>
          {check.text}
        </span>
      ) : (
        <span className="ml-2 text-zinc-400">次の発話で検証</span>
      )}
    </span>
  );
}

const VERDICT_TEXT = {
  drop: "雑談",
  apply: "業務 · 図に反映",
  confirm: "業務 · 要確認",
  unchanged: "業務 · 図は変更なし",
} as const;

function AnalysisView({ analysis, devMode }: { analysis: LineAnalysis; devMode: boolean }) {
  if (analysis.state === "pending") {
    return <span className="ml-2 text-xs text-zinc-400">⋯ Jev で判定中</span>;
  }
  if (analysis.state === "error") {
    return (
      <span className="ml-2 text-xs text-red-600 dark:text-red-400">
        判定エラー: {analysis.error}
      </span>
    );
  }
  const strength =
    analysis.verdict === "drop" ? analysis.chatter : 1 - analysis.chatter;
  const cls =
    analysis.verdict === "drop"
      ? "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
      : analysis.verdict === "apply"
        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300"
        : analysis.verdict === "confirm"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300"
          : "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300";
  return (
    <>
      <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${cls}`} title={analysis.summary}>
        {VERDICT_TEXT[analysis.verdict]}
        {devMode && ` ${strength.toFixed(2)}`}
      </span>
      {devMode && analysis.match === "match" && (
        <span className="ml-2 text-xs text-emerald-600 dark:text-emerald-400">台本と一致</span>
      )}
      {devMode && analysis.match === "mismatch" && (
        <span className="ml-2 text-xs font-medium text-red-600 dark:text-red-400">台本と不一致</span>
      )}
      {devMode && <span className="block pl-1 text-xs text-zinc-500">{analysis.summary}</span>}
    </>
  );
}

/** 送信待ちがこれを超えたら、最も古いものを捨てて「今」に追従する */
const MAX_PENDING = 2;
const NORMAL_SEGMENT_MS = 12_000;
const CATCHING_UP_SEGMENT_MS = 8_000;

type Props = {
  /** 行は左右のペインで共有するため、親（Studio）が持つ */
  lines: Line[];
  setLines: Dispatch<SetStateAction<Line[]>>;
  /** 文字起こしが確定した行。Jev での判定に回す */
  onFinalText: (lineId: string, text: string) => void;
  jevEnabled: boolean;
  onJevEnabledChange: (enabled: boolean) => void;
  /** 判定器の送り先の初期値（切り替えはバックエンドの状態ダイアログで行い、ここへ同期される） */
  jevBackend: JevBackend;
  /** true の間はマイクの入力を無視する（ファシリテーターの読み上げ中） */
  paused?: boolean;
  /** 開発用サンプルパネルが出ているか（空状態の案内文を変える） */
  devMode?: boolean;
  /** 図から自動で集めた語彙ヒント（対象業務名・登場人物名・書類/システム名）。会議が進むほど育つ */
  autoVocab?: string;
};

export function MicTranscriber({
  lines,
  setLines,
  onFinalText,
  jevEnabled,
  onJevEnabledChange,
  jevBackend: initialJevBackend,
  paused = false,
  devMode = false,
  autoVocab = "",
}: Props) {
  const [jevBackend] = useJevBackend(initialJevBackend);
  /** 利用者が手で足す分だけを持つ。自動の語彙とは送信時に合成し、自動側の増減で消えたりしない */
  const [manualVocab, setManualVocab] = useState("");

  const combinedVocab = combineVocab(autoVocab, manualVocab);
  const vocabRef = useRef(combinedVocab);
  const onFinalTextRef = useRef(onFinalText);
  useEffect(() => {
    onFinalTextRef.current = onFinalText;
  });
  const pendingRef = useRef<Pending[]>([]);
  const busyRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const setMaxSegmentMsRef = useRef<(ms: number) => void>(() => {});

  useEffect(() => {
    vocabRef.current = combinedVocab;
  });

  const patchLine = useCallback(
    (id: string, patch: Partial<Line>) => {
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    },
    [setLines],
  );

  const pump = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      let next: Pending | undefined;
      while ((next = pendingRef.current.shift())) {
        setMaxSegmentMsRef.current(
          pendingRef.current.length >= 1 ? CATCHING_UP_SEGMENT_MS : NORMAL_SEGMENT_MS,
        );
        try {
          const form = new FormData();
          form.append("audio", next.blob, "segment.wav");
          form.append("vocab", vocabRef.current);
          const res = await fetch("/api/transcribe", { method: "POST", body: form });
          const json = (await res.json()) as {
            text?: string;
            raw?: string;
            latencyMs?: number;
            error?: string;
          };
          if (!res.ok || json.error) {
            patchLine(next.id, { status: "error", error: json.error ?? `HTTP ${res.status}` });
          } else if (!json.text) {
            patchLine(next.id, { status: "silent", raw: json.raw, latencyMs: json.latencyMs });
          } else {
            patchLine(next.id, {
              status: "done",
              text: json.text,
              raw: json.raw,
              latencyMs: json.latencyMs,
            });
            onFinalTextRef.current(next.id, json.text);
          }
        } catch (e) {
          patchLine(next.id, {
            status: "error",
            error: e instanceof Error ? e.message : "送信に失敗しました",
          });
        }
      }
    } finally {
      busyRef.current = false;
      setMaxSegmentMsRef.current(NORMAL_SEGMENT_MS);
    }
  }, [patchLine]);

  const onSegment = useCallback(
    (segment: Segment) => {
      const id = newId();
      const blob = encodeWav(resampleTo16k(segment.pcm, segment.sampleRate));
      setLines((prev) => [
        ...prev,
        { id, at: clock(), status: "transcribing", text: "", audioMs: segment.durationMs },
      ]);

      pendingRef.current.push({ id, blob });
      // 遅れて追いつくより、古いものを捨てて今に追従する
      while (pendingRef.current.length > MAX_PENDING) {
        const dropped = pendingRef.current.shift();
        if (dropped) patchLine(dropped.id, { status: "dropped" });
      }
      void pump();
    },
    [patchLine, pump, setLines],
  );

  const recorder = useRecorder({ onSegment });

  useEffect(() => {
    setMaxSegmentMsRef.current = recorder.setMaxSegmentMs;
  }, [recorder.setMaxSegmentMs]);

  const { setPaused } = recorder;
  useEffect(() => {
    setPaused(paused);
  }, [paused, setPaused]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const recording = recorder.state === "recording";

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div className="flex items-start gap-4">
        {/* 左: 一番押す操作なので、正方形の大きなボタンにして目立たせる（トップページの
            「会議を始める」ボタンと同じ作法）。真下に、ボタンの状態と直結するマイク音量・状態文字を置く */}
        <div className="flex shrink-0 flex-col items-center gap-2">
          <button
            type="button"
            onClick={recording ? recorder.stop : () => void recorder.start()}
            disabled={recorder.state === "starting"}
            className={`group flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-2xl shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-lg active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none ${
              recording ? "bg-red-600 text-white hover:bg-red-700" : "bg-foreground text-background"
            }`}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              {/* 録音中は、この丸が心拍のように鼓動する（transform-box を fill-box にして、
                  丸自身の中心を基準に拡大縮小させる） */}
              <circle
                cx="12"
                cy="12"
                r="7"
                fill="currentColor"
                className={recording ? "origin-center animate-heartbeat [transform-box:fill-box]" : ""}
              />
            </svg>
            <span className="text-xs font-medium">
              {recorder.state === "starting" ? "準備中…" : recording ? "停止" : "録音開始"}
            </span>
          </button>

          <div
            className="h-2 w-20 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
            role="meter"
            aria-label="マイクの音量"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={recording ? recorder.level : 0}
          >
            <div
              className={`h-full transition-[width] duration-75 ${
                recorder.speaking ? "bg-emerald-500" : "bg-zinc-400"
              }`}
              style={{ width: `${Math.round((recording ? recorder.level : 0) * 100)}%` }}
            />
          </div>

          <span className="text-center text-xs text-zinc-500">
            {recording
              ? paused
                ? "読み上げ中（一時停止）"
                : recorder.speaking
                  ? "発話を検出"
                  : "待機中"
              : "停止中"}
            {devMode && recorder.sampleRate ? ` · ${recorder.sampleRate / 1000}kHz` : ""}
          </span>
        </div>

        {/* 右: 見出し・Jevトグルと、追加の語彙ヒント */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="font-medium">文字起こし</h2>
              <span
                className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-white/10 dark:text-zinc-300"
                title="音声認識にはローカルの whisper.cpp（Whisper）を使っています。音声は外に出ません"
              >
                Whisper
              </span>
            </div>
            <ToggleSwitch
              checked={jevEnabled}
              onChange={onJevEnabledChange}
              label="Jev"
              title={
                jevBackend === "local"
                  ? "ON の間、確定した文字起こしを 1 行ごとにローカル判定器（Jev の代わり）で判定します。外部には送りません"
                  : "ON の間、確定した文字起こしを 1 行ごとに Jev（外部 API・課金）へ送って判定します"
              }
            />
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center justify-between gap-2">
              <span
                className="shrink-0 text-zinc-600 dark:text-zinc-400"
                title="対象業務名・登場人物名・書類やシステムの名前は、図が育つのに合わせて自動で whisper に渡ります。ここには、まだ図に出ていない語彙だけ足してください"
              >
                語彙ヒント
              </span>
              {autoVocab && (
                <span className="min-w-0 truncate text-xs text-zinc-400" title={`自動: ${autoVocab}`}>
                  自動: {autoVocab}
                </span>
              )}
            </span>
            <input
              value={manualVocab}
              onChange={(e) => setManualVocab(e.target.value)}
              placeholder="任意"
              className="rounded-md border border-black/15 bg-transparent px-3 py-2 dark:border-white/20"
            />
          </label>
        </div>
      </div>

      {recorder.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {recorder.error}
        </p>
      )}

      <div className="min-h-32 flex-1 overflow-y-auto rounded-md border border-black/10 p-3 dark:border-white/15">
        {lines.length === 0 ? (
          <p className="text-sm text-zinc-500">
            「録音開始」を押して話すと、区切りごとにここへ行が増えます。最初の 1 秒は環境音の計測に使います。
            {devMode && "マイクなしで試すときは、下の「開発用サンプル」を使えます。"}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {lines.map((l) => (
              <li key={l.id} className="text-sm">
                <span className="mr-2 tabular-nums text-zinc-500">{l.at}</span>
                {l.sample && (
                  <span className="mr-2 rounded bg-sky-100 px-1.5 py-0.5 text-xs text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                    サンプル
                  </span>
                )}
                {l.status === "transcribing" && (
                  <span className="text-zinc-500">⋯ 文字起こし中（{(l.audioMs / 1000).toFixed(1)}秒）</span>
                )}
                {l.status === "done" && (
                  <span className={l.tag === "chatter" ? "text-zinc-500" : ""}>{l.text}</span>
                )}
                {l.status === "silent" && (
                  <span className="text-zinc-500">
                    （音声なし{l.raw ? `・除外: ${l.raw}` : ""}）
                  </span>
                )}
                {l.status === "dropped" && (
                  <span className="text-amber-600 dark:text-amber-400">
                    （処理が追いつかず破棄）
                  </span>
                )}
                {l.status === "error" && (
                  <span className="text-red-600 dark:text-red-400">エラー: {l.error}</span>
                )}
                {devMode && l.latencyMs !== undefined && (
                  <span className="ml-2 tabular-nums text-xs text-zinc-400">
                    {l.latencyMs}ms
                  </span>
                )}
                {l.analysis && <AnalysisView analysis={l.analysis} devMode={devMode} />}
                {l.labeling && <LabelingView labeling={l.labeling} devMode={devMode} />}
              </li>
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
