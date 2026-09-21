"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Interpretation } from "@/lib/analysis/interpret";
import { modelFromScope } from "@/lib/model/reducer";
import type { FlowModel } from "@/lib/model/types";
import type { ArchivedDiagram } from "@/lib/scope/apply";
import type { SessionSeed } from "@/lib/store/session-types";
import { APP_SCENARIO, SAMPLE_SCENARIO, SAMPLE_SHIFT_SCENARIO } from "@/lib/sample/scenario";
import { clock, type Line, type LineLabeling } from "@/lib/transcript/line";
import { DiagramPane } from "./diagram-pane";
import { DiagramTabs } from "./diagram-tabs";
import { FacilitatorPane } from "./facilitator-pane";
import { JevConsole } from "./jev-console";
import { MicTranscriber } from "./mic-transcriber";
import { SamplePanel, type SampleMode } from "./sample-panel";
import { ScopeBanner } from "./scope-banner";
import { useAutosave, type SaveStatus } from "./use-autosave";
import { useFacilitator } from "./use-facilitator";
import { usePipeline, type AnalysisJob } from "./use-pipeline";
import { useScopeShift } from "./use-scope-shift";
import { useSpeech } from "./use-speech";

const SAMPLE_INTERVAL_MS = 1_800;
/** 手動で「答えた」にしたときの記録（発言そのものは無い） */
const MANUAL_ANSWER = "（会議で回答済み）";

export type StudioSession = {
  slug: string;
  seed: SessionSeed;
  model: FlowModel;
  archives: ArchivedDiagram[];
  lines: Line[];
};

const SAVE_LABEL: Record<SaveStatus, { text: string; cls: string }> = {
  saved: { text: "保存済み", cls: "text-zinc-500" },
  saving: { text: "保存中…", cls: "text-zinc-500" },
  error: { text: "保存できていません（再試行します）", cls: "text-amber-600 dark:text-amber-400" },
};

/** 3 列（文字起こし / 図とファシリテーター / jev コンソール）で状態を共有するための親。 */
export function Studio({ session }: { session: StudioSession }) {
  const [lines, setLines] = useState<Line[]>(session.lines);
  // やり直し（リセット）で戻る先は、会議を始めたときの初期設定
  const initialModel = useCallback(
    () => modelFromScope(session.seed.title, [...session.seed.departments], new Date().toISOString()),
    [session.seed],
  );
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<SampleMode>("script");
  const [withShift, setWithShift] = useState(false);
  /** 台本の題材。"app" はこのアプリの仕組み（jev モード専用） */
  const [topic, setTopic] = useState<"loan" | "app">("loan");
  const [jevEnabled, setJevEnabled] = useState(true);
  const [speakEnabled, setSpeakEnabled] = useState(false);
  /** いま見ている図。"current" か、過去の図の id */
  const [viewId, setViewId] = useState("current");
  const jevEnabledRef = useRef(jevEnabled);
  const linesRef = useRef(lines);
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    jevEnabledRef.current = jevEnabled;
    linesRef.current = lines;
  });

  const patchLine = useCallback((id: string, patch: Partial<Line>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  /** labeling は一部の項目だけ更新する（検証結果を、生成結果を消さずに足すため） */
  const patchLabeling = useCallback((id: string, patch: Partial<LineLabeling>) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === id ? { ...l, labeling: { ...l.labeling, ...patch } as LineLabeling } : l,
      ),
    );
  }, []);

  // パイプラインが 1 発話を判定するたびに、対象業務のズレの検知へ渡す。
  // 検知のフックはパイプラインの API を使うので、参照を介して橋渡しする。
  const observeRef = useRef<(i: Interpretation, job: AnalysisJob) => void>(() => {});
  const onInterpretation = useCallback(
    (i: Interpretation, job: AnalysisJob) => observeRef.current(i, job),
    [],
  );

  const pipeline = usePipeline({
    onInterpretation,
    patchLine,
    patchLabeling,
    initialModel,
    resumeModel: session.model,
    initialArchives: session.archives,
  });
  const { analyze, applyScript, commit, getModel, getSignals, pushEntry, splitDiagram } = pipeline;
  const { reset: resetPipeline } = pipeline;

  const shift = useScopeShift({ getModel, commit, splitDiagram, pushEntry });
  const { reset: resetShift, split: splitByProposal } = shift;
  useEffect(() => {
    observeRef.current = shift.observe;
  });

  /** 問いの生成と選別の文脈: 直近の業務の発言（雑談は除く） */
  const getRecent = useCallback(
    () =>
      linesRef.current
        .filter(
          (l) =>
            l.status === "done" &&
            l.tag !== "chatter" &&
            !(l.analysis?.state === "done" && l.analysis.verdict === "drop"),
        )
        .slice(-6)
        .map((l) => l.text),
    [],
  );

  const facilitator = useFacilitator({ getModel, getSignals, getRecent, commit, pushEntry });
  const { generate: generateQuestion, reset: resetFacilitator } = facilitator;
  const speech = useSpeech();
  const { speak, cancel: cancelSpeech } = speech;

  const asked = pipeline.model.issues.find((i) => i.status === "asked") ?? null;
  const askedId = asked?.id ?? null;
  const askedText = asked?.prompt?.text ?? null;

  // 新しい問いが出たら読み上げる（ON のとき）。同じ問いを二度は読まない（もう一度は手動）。
  useEffect(() => {
    if (!askedId || !askedText || lastSpokenRef.current === askedId) return;
    lastSpokenRef.current = askedId;
    if (speakEnabled) speak(askedText);
  }, [askedId, askedText, speakEnabled, speak]);

  const onMicText = useCallback(
    (lineId: string, text: string) => {
      if (jevEnabledRef.current) analyze({ lineId, text });
    },
    [analyze],
  );

  const scenario = useMemo(
    () =>
      topic === "app"
        ? APP_SCENARIO
        : withShift
          ? [...SAMPLE_SCENARIO, ...SAMPLE_SHIFT_SCENARIO]
          : SAMPLE_SCENARIO,
    [topic, withShift],
  );
  const finished = cursor >= scenario.length;

  const playNext = useCallback(() => {
    const entry = scenario[cursor];
    if (!entry) return;
    const id = crypto.randomUUID();
    const base: Line = {
      id,
      at: clock(),
      status: "done",
      text: entry.text,
      audioMs: 0,
      sample: true,
    };

    if (mode === "script") {
      setLines((prev) => [...prev, { ...base, tag: entry.kind }]);
      applyScript(entry.ops);
    } else {
      setLines((prev) => [...prev, { ...base, expected: entry.kind }]);
      analyze({ lineId: id, text: entry.text, expected: entry.kind });
    }
    setCursor(cursor + 1);
  }, [cursor, mode, scenario, applyScript, analyze]);

  useEffect(() => {
    if (!playing || finished) return;
    const timer = setTimeout(playNext, SAMPLE_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [playing, finished, playNext]);

  const reset = useCallback(() => {
    resetPipeline();
    resetFacilitator();
    resetShift();
    cancelSpeech();
    lastSpokenRef.current = null;
    setLines([]);
    setCursor(0);
    setPlaying(false);
    setViewId("current");
  }, [resetPipeline, resetFacilitator, resetShift, cancelSpeech]);

  /** 「図を分ける」: 前の図に向けた問いかけ・読み上げは新しい図には持ち込まない */
  const onSplit = useCallback(() => {
    splitByProposal();
    resetFacilitator();
    cancelSpeech();
    lastSpokenRef.current = null;
    setViewId("current");
  }, [splitByProposal, resetFacilitator, cancelSpeech]);

  // ── ファシリテーターの操作 ──
  const onAnswered = useCallback(
    (id: string) => {
      cancelSpeech();
      commit([{ op: "issue.resolve", id, answer: MANUAL_ANSWER }], "manual");
    },
    [commit, cancelSpeech],
  );
  const onPark = useCallback(
    (id: string) => {
      cancelSpeech();
      commit([{ op: "issue.park", id }], "manual");
    },
    [commit, cancelSpeech],
  );
  const onNext = useCallback(
    (id: string) => {
      onPark(id);
      // 保留にした問いは「保留」に入り、次の生成では避けられる
      void generateQuestion(true);
    },
    [onPark, generateQuestion],
  );

  const saveStatus = useAutosave(session.slug, pipeline.model, pipeline.archives, lines);

  /** 仮のステップの承認・却下。承認は確定（実線）に、却下は取り消し（履歴には残る） */
  const onDecideStep = useCallback(
    (id: string, decision: "approve" | "reject") => {
      commit(
        decision === "approve"
          ? [{ op: "step.update", id, patch: { status: "confirmed", confidence: 1 } }]
          : [{ op: "step.retract", id }],
        "manual",
      );
    },
    [commit],
  );

  const archived = pipeline.archives.find((a) => a.id === viewId) ?? null;
  const viewing = archived ? archived.model : pipeline.model;

  return (
    <>
      <p className={`px-4 py-0.5 text-right text-xs ${SAVE_LABEL[saveStatus].cls}`} aria-live="polite">
        {SAVE_LABEL[saveStatus].text}
      </p>
      <ScopeBanner
        proposal={shift.proposal}
        status={shift.status}
        onSplit={onSplit}
        onRename={shift.rename}
        onDismiss={shift.dismiss}
      />
      {/* 3 列: 左=文字起こし / 中=ファシリテーターと図 / 右=jev コンソール（折りたためる）。
          1024px 未満は縦に積み、ページ全体をスクロールさせる。 */}
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:overflow-hidden">
        <div className="flex min-h-[28rem] flex-col border-b border-black/10 lg:min-h-0 lg:border-b-0 lg:border-r dark:border-white/15">
          <MicTranscriber
            lines={lines}
            setLines={setLines}
            onFinalText={onMicText}
            jevEnabled={jevEnabled}
            onJevEnabledChange={setJevEnabled}
            paused={speech.speaking}
          />
          <SamplePanel
            cursor={cursor}
            total={scenario.length}
            playing={playing}
            mode={mode}
            onModeChange={setMode}
            topic={topic}
            onTopicChange={(t) => {
              setTopic(t);
              setCursor(0);
              setPlaying(false);
              if (t === "app") setMode("jev");
            }}
            withShift={withShift}
            onWithShiftChange={setWithShift}
            onTogglePlay={() => setPlaying((p) => !p)}
            onNext={playNext}
            onReset={reset}
          />
        </div>
        <div className="flex min-h-[28rem] flex-col lg:min-h-0 lg:overflow-y-auto">
          <FacilitatorPane
            asked={asked}
            status={facilitator.status}
            auto={facilitator.auto}
            onAutoChange={facilitator.setAuto}
            speakSupported={speech.supported}
            speakEnabled={speakEnabled}
            onSpeakEnabledChange={(on) => {
              setSpeakEnabled(on);
              if (!on) cancelSpeech();
            }}
            speaking={speech.speaking}
            onGenerate={() => void generateQuestion(true)}
            onAnswered={onAnswered}
            onPark={onPark}
            onNext={onNext}
            onReplay={() => askedText && speak(askedText)}
          />
          <DiagramTabs
            archives={pipeline.archives}
            currentTitle={pipeline.model.scope.title}
            viewId={viewId}
            onView={setViewId}
          />
          {archived && (
            <p className="border-b border-black/10 bg-zinc-50 px-4 py-1.5 text-xs text-zinc-500 dark:border-white/15 dark:bg-white/5">
              過去の図（読み取り専用）です。「図を分ける」までの内容が残っています。
            </p>
          )}
          <DiagramPane
            model={viewing}
            source={archived ? "none" : pipeline.source}
            onDecideStep={archived ? undefined : onDecideStep}
          />
        </div>
        <JevConsole entries={pipeline.entries} />
      </main>
    </>
  );
}
