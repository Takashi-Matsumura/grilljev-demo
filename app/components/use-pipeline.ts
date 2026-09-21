"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ActorsResult, StepLabelResult } from "@/lib/analysis/label";
import { buildActorStepOps, buildLabelOps, previousBranchOf, type ActorPlan } from "@/lib/analysis/label-ops";
import type { FollowUp, Interpretation } from "@/lib/analysis/interpret";
import type { UtteranceState } from "@/lib/analysis/questions";
import { rebaseOps } from "@/lib/analysis/rebase";
import { BRANCH_HINT_MIN } from "@/lib/analysis/thresholds";
import { checkKey, MAX_CHECKS_PER_REQUEST, type PendingCheck } from "@/lib/analysis/verify";
import type { JevExchange } from "@/lib/jev";
import { applyOps } from "@/lib/model/reducer";
import { splitModel, type ArchivedDiagram } from "@/lib/scope/apply";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { clock, type Line, type LineLabeling } from "@/lib/transcript/line";
import type { UpdateSource } from "./diagram-pane";
import type { ConsoleEntry } from "./jev-console";

/** コンソールに残す件数（送信 JSON が大きいので無制限にしない） */
const MAX_CONSOLE_ENTRIES = 30;
const RECENT_UTTERANCES = 3;
/** 検証待ちを溜めすぎない（古いものは検証されないまま採用される） */
const MAX_PENDING = MAX_CHECKS_PER_REQUEST * 2;

export type AnalysisJob = { lineId: string; text: string; expected?: "chatter" | "business" };

type LabelJob = {
  kind: "label";
  /** どの図（世代）に対する処理か。図を分けたあとに古い図の処理が新しい図へ混ざらないようにする */
  doc: number;
  lineId: string;
  utterance: string;
  stepId: string;
  branchHint: number;
  /** 何回目の生成か */
  attempts: number;
  /** 作り直しのとき、不適切と判断された以前の文言 */
  avoid?: string;
};
type ActorsJob = { kind: "actors"; doc: number; lineId: string; plan: ActorPlan };
type FollowJob = LabelJob | ActorsJob;

/** 検証待ち + それが属する行（結果を行に戻して表示するため）と、作り直しに要る手がかり */
type Pending = { check: PendingCheck; lineId: string; branchHint: number };

type AnalyzeResponse = {
  interpretation?: Interpretation;
  exchange?: JevExchange<UtteranceState>;
  error?: string;
};

export type Signals = {
  /** 判定した発話の数 */
  analyzed: number;
  /** 最初に判定した時刻（会議の開始） */
  startedAt: number;
  lastActivityAt: number;
  /** 直近の判定での jev の grill_now（0..4） */
  grillScore: number;
};

type Options = {
  /** 1 発話の判定が済むたびに呼ばれる（対象業務のズレの検知など） */
  onInterpretation?: (interpretation: Interpretation, job: AnalysisJob) => void;
  patchLine: (id: string, patch: Partial<Line>) => void;
  patchLabeling: (id: string, patch: Partial<LineLabeling>) => void;
  initialModel: () => FlowModel;
  /** 保存済みの会議を再開するときの、過去の図 */
  initialArchives?: ArchivedDiagram[];
  /** 保存済みの会議を再開するときの、最初の図（リセットで戻る先は initialModel のまま） */
  resumeModel?: FlowModel;
};

/**
 * 「文字起こし 1 行 → jev で判定 → 図を更新 → gemma で文言を付ける → 次の発話で jev が検証」
 * の流れを受け持つ。
 *
 * - 判定（jev）は 1 件ずつ直列に処理し、そのつど最新のモデルを送る（採番の衝突を避ける）
 * - gemma の後続処理は別の直列キュー。**jev の待ち行列を止めない**（gemma は 1〜4 秒かかる）
 * - 後続処理の結果は、**適用する瞬間の最新モデル**から採番して適用する
 * - リセットのたびに世代（epoch）を進め、リセット前に飛んだ処理の結果を捨てる
 */
export function usePipeline({
  onInterpretation,
  patchLine,
  patchLabeling,
  initialModel,
  initialArchives,
  resumeModel,
}: Options) {
  const [model, setModel] = useState<FlowModel>(() => resumeModel ?? initialModel());
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [source, setSource] = useState<UpdateSource>("none");
  /** 「図を分ける」で退避した過去の図（読み取り専用） */
  const [archives, setArchives] = useState<ArchivedDiagram[]>(() => initialArchives ?? []);

  const modelRef = useRef(model);
  const epochRef = useRef(0);
  /** 図の世代。「図を分ける」で進める */
  const docRef = useRef(0);
  const onInterpretationRef = useRef(onInterpretation);
  useEffect(() => {
    onInterpretationRef.current = onInterpretation;
  });
  const analysisQueue = useRef<AnalysisJob[]>([]);
  const analysisBusy = useRef(false);
  const followQueue = useRef<FollowJob[]>([]);
  const followBusy = useRef(false);
  const recentRef = useRef<string[]>([]);
  const pendingRef = useRef<Pending[]>([]);
  /** ファシリテーターが出すタイミングを測る信号（判定のたびに更新） */
  const signalsRef = useRef<Signals>({ analyzed: 0, startedAt: 0, lastActivityAt: 0, grillScore: 0 });

  const commitOps = useCallback((ops: ModelOp[], from: UpdateSource) => {
    if (ops.length === 0) return;
    const next = applyOps(modelRef.current, ops, new Date().toISOString());
    modelRef.current = next;
    setModel(next);
    setSource(from);
  }, []);

  const pushEntry = useCallback((entry: ConsoleEntry) => {
    setEntries((prev) => [...prev, entry].slice(-MAX_CONSOLE_ENTRIES));
  }, []);

  const addPending = useCallback((p: Pending) => {
    const key = checkKey(p.check);
    pendingRef.current = [...pendingRef.current.filter((x) => checkKey(x.check) !== key), p].slice(
      -MAX_PENDING,
    );
  }, []);

  // ── gemma の後続処理 ────────────────────────────────────────────

  const runFollowUp = useCallback(
    async (job: FollowJob, enqueue: (j: FollowJob) => void) => {
      const epoch = epochRef.current;
      const alive = () => epoch === epochRef.current && job.doc === docRef.current;
      if (!alive()) return; // 図を分けた・リセットした。古い図に対する処理は捨てる
      const fail = (message: string) => {
        if (alive()) patchLabeling(job.lineId, { state: "error", error: message });
      };
      const post = async <T>(body: unknown): Promise<T & { error?: string }> => {
        const res = await fetch("/api/label", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as T & { error?: string };
        if (!res.ok && !json.error) json.error = `HTTP ${res.status}`;
        return json;
      };

      try {
        if (job.kind === "actors") {
          const { plan } = job;
          const need = (["from", "to"] as const).filter((s) => plan.need[s]);
          patchLabeling(job.lineId, { state: "pending", note: "登場人物を特定中", error: undefined });
          const json = await post<ActorsResult>({
            mode: "actors",
            utterance: plan.utterance,
            knownActors: modelRef.current.actors.map((a) => a.name),
            need,
          });
          if (!alive()) return;
          if (json.error) return fail(json.error);

          const built = buildActorStepOps(modelRef.current, plan, { from: json.from, to: json.to });
          if (!built) return fail("登場人物の名前を特定できなかったため、図に追加しませんでした");
          commitOps(built.ops, "jev");
          for (const c of built.created) {
            addPending({
              check: { kind: "actor", actorId: c.id, name: c.name },
              lineId: job.lineId,
              branchHint: 0,
            });
          }
          const names = built.created.map((c) => c.name).join("・");
          patchLabeling(job.lineId, {
            state: "pending",
            note: names ? `登場人物「${names}」を追加。ステップ名を生成中` : "ステップ名を生成中",
          });
          enqueue({
            kind: "label",
            doc: job.doc,
            lineId: job.lineId,
            utterance: plan.utterance,
            stepId: built.stepId,
            branchHint: plan.branchHint,
            attempts: 1,
          });
          return;
        }

        // ── ステップ名（と書類名・分岐）の生成 ──
        const current = modelRef.current;
        const step = current.steps.find((s) => s.id === job.stepId && s.status !== "retracted");
        if (!step) return; // 取り消された・消えた
        const nameOf = (id: string) => current.actors.find((a) => a.id === id)?.name ?? id;
        const prev = previousBranchOf(current, job.stepId);

        patchLabeling(job.lineId, {
          state: "pending",
          note: job.attempts > 1 ? "ステップ名を作り直し中" : "ステップ名を生成中",
          error: undefined,
        });
        const json = await post<StepLabelResult>({
          mode: "step",
          utterance: job.utterance,
          from: nameOf(step.from),
          to: nameOf(step.to),
          messageKind: step.kind,
          branchHint: job.branchHint >= BRANCH_HINT_MIN,
          previousBranch: prev ? { condition: prev.condition, kind: prev.kind } : null,
          avoid: job.avoid,
        });
        if (!alive()) return;
        if (json.error) return fail(json.error);

        const ops = buildLabelOps(modelRef.current, job.stepId, json);
        if (ops.length === 0) return;
        commitOps(ops, "jev");
        addPending({
          check: {
            kind: "label",
            stepId: job.stepId,
            label: json.label,
            source: job.utterance,
            attempts: job.attempts,
          },
          lineId: job.lineId,
          branchHint: job.branchHint,
        });
        patchLabeling(job.lineId, {
          state: "done",
          label: json.label,
          ms: json.ms,
          note: json.branch ? `分岐「${json.branch.condition}」を検出` : undefined,
          check: undefined,
        });
      } catch (e) {
        fail(e instanceof Error ? e.message : "文言の生成に失敗しました");
      }
    },
    [addPending, commitOps, patchLabeling],
  );

  const drainFollow = useCallback(async () => {
    if (followBusy.current) return;
    followBusy.current = true;
    const enqueue = (j: FollowJob) => {
      followQueue.current.push(j);
    };
    try {
      let job: FollowJob | undefined;
      while ((job = followQueue.current.shift())) await runFollowUp(job, enqueue);
    } finally {
      followBusy.current = false;
    }
  }, [runFollowUp]);

  const enqueueFollow = useCallback(
    (job: FollowJob) => {
      followQueue.current.push(job);
      void drainFollow();
    },
    [drainFollow],
  );

  const followUpsToJobs = useCallback(
    (followUps: FollowUp[], job: AnalysisJob, utteranceId: string, doc: number): FollowJob[] =>
      followUps.map((fu) =>
        fu.kind === "label"
          ? {
              kind: "label" as const,
              doc,
              lineId: job.lineId,
              utterance: job.text,
              stepId: fu.stepId,
              branchHint: fu.branchHint,
              attempts: 1,
            }
          : {
              kind: "actors" as const,
              doc,
              lineId: job.lineId,
              plan: { ...fu, utterance: job.text, utteranceId },
            },
      ),
    [],
  );

  // ── jev の判定 ──────────────────────────────────────────────────

  const runAnalysis = useCallback(
    async (job: AnalysisJob) => {
      const epoch = epochRef.current;
      const doc = docRef.current;
      const fail = (message: string) => {
        if (epoch !== epochRef.current) return;
        patchLine(job.lineId, { analysis: { state: "error", error: message } });
        pushEntry({ id: crypto.randomUUID(), at: clock(), utterance: job.text, error: message });
      };

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            utterance: job.text,
            utteranceId: job.lineId,
            model: modelRef.current,
            recent: recentRef.current,
            // 前の発話で gemma が作った文言の検証を、この質問に相乗りさせる
            verify: pendingRef.current.map((p) => p.check).slice(-MAX_CHECKS_PER_REQUEST),
          }),
        });
        const json = (await res.json()) as AnalyzeResponse;
        if (epoch !== epochRef.current) return;
        if (!res.ok || json.error || !json.interpretation || !json.exchange) {
          fail(json.error ?? `HTTP ${res.status}`);
          return;
        }

        const { interpretation, exchange } = json;

        // 判定を待つ間に「図を分けた」なら、この判定は前の図（のモデル）に対するもの。
        // 新しい図に当てると、id や登場人物が食い違うので反映しない。
        if (doc !== docRef.current) {
          patchLine(job.lineId, {
            analysis: {
              state: "done",
              verdict: interpretation.verdict,
              chatter: interpretation.chatter,
              summary: "図を分けたため、この発言の判定は前の図のものとして反映していません",
            },
          });
          pushEntry({ id: crypto.randomUUID(), at: clock(), utterance: job.text, exchange, interpretation });
          return;
        }

        // 検証の結果: 待ちから外し、行に戻して表示し、作り直しが要るものは gemma に回す
        const relabel: FollowJob[] = [];
        for (const r of interpretation.checks) {
          const found = pendingRef.current.find((p) => checkKey(p.check) === r.key);
          pendingRef.current = pendingRef.current.filter((p) => checkKey(p.check) !== r.key);
          if (!found) continue;
          if (r.outcome !== "stale") {
            patchLabeling(found.lineId, { check: { outcome: r.outcome, detail: r.detail } });
          }
          if (r.outcome === "relabel" && found.check.kind === "label") {
            relabel.push({
              kind: "label",
              doc: docRef.current,
              lineId: found.lineId,
              utterance: found.check.source,
              stepId: found.check.stepId,
              branchHint: found.branchHint,
              attempts: found.check.attempts + 1,
              avoid: found.check.label,
            });
          }
        }

        // 解釈はリクエスト時点のモデルで採番している。その間に gemma がステップを足していると
        // id が衝突して黙って消えるので、**適用する瞬間の最新モデル**で採番し直す。
        const rebased = rebaseOps(modelRef.current, interpretation.ops, interpretation.followUps);
        commitOps(rebased.ops, "jev");
        recentRef.current = [...recentRef.current, job.text].slice(-RECENT_UTTERANCES);

        const now = Date.now();
        const sig = signalsRef.current;
        if (sig.analyzed === 0) sig.startedAt = now;
        sig.analyzed += 1;
        sig.lastActivityAt = now;
        sig.grillScore = interpretation.grillScore;

        // 質問を出したのに、答えないまま業務の話（図の内容）が続いたら数える。
        // 2 回で保留にして、同じ問いで会議が滞留しないようにする。
        const asked = modelRef.current.issues.find((i) => i.status === "asked");
        const intentName = interpretation.intent?.name ?? "";
        const isContent = intentName.startsWith("describe_") || intentName === "correct_previous";
        const resolvedNow = rebased.ops.some((o) => o.op === "issue.resolve" && o.id === asked?.id);
        if (asked && isContent && interpretation.verdict !== "drop" && !resolvedNow) {
          commitOps([{ op: "issue.skip", id: asked.id }], "jev");
        }

        const isChatter = interpretation.verdict === "drop";
        const match =
          job.expected === undefined
            ? undefined
            : (job.expected === "chatter") === isChatter
              ? "match"
              : "mismatch";
        patchLine(job.lineId, {
          analysis: {
            state: "done",
            verdict: interpretation.verdict,
            chatter: interpretation.chatter,
            summary: interpretation.summary,
            match,
          },
        });
        pushEntry({
          id: crypto.randomUUID(),
          at: clock(),
          utterance: job.text,
          exchange,
          interpretation,
        });

        for (const j of [...relabel, ...followUpsToJobs(rebased.followUps, job, job.lineId, doc)]) {
          enqueueFollow(j);
        }
        onInterpretationRef.current?.(interpretation, job);
      } catch (e) {
        fail(e instanceof Error ? e.message : "判定に失敗しました");
      }
    },
    [commitOps, enqueueFollow, followUpsToJobs, patchLabeling, patchLine, pushEntry],
  );

  const drain = useCallback(async () => {
    if (analysisBusy.current) return;
    analysisBusy.current = true;
    try {
      let job: AnalysisJob | undefined;
      while ((job = analysisQueue.current.shift())) await runAnalysis(job);
    } finally {
      analysisBusy.current = false;
    }
  }, [runAnalysis]);

  /** 文字起こし 1 行を jev の判定に回す */
  const analyze = useCallback(
    (job: AnalysisJob) => {
      patchLine(job.lineId, { analysis: { state: "pending" } });
      analysisQueue.current.push(job);
      void drain();
    },
    [patchLine, drain],
  );

  /** 台本モード: 固定の変更をそのまま適用する（jev も gemma も呼ばない） */
  const applyScript = useCallback(
    (ops: ModelOp[]) => commitOps(ops, "script"),
    [commitOps],
  );

  const reset = useCallback(() => {
    epochRef.current += 1;
    analysisQueue.current = [];
    followQueue.current = [];
    recentRef.current = [];
    pendingRef.current = [];
    signalsRef.current = { analyzed: 0, startedAt: 0, lastActivityAt: 0, grillScore: 0 };
    docRef.current += 1;
    setArchives([]);
    const fresh = initialModel();
    modelRef.current = fresh;
    setModel(fresh);
    setSource("none");
  }, [initialModel]);

  /** ファシリテーターや手動操作から、モデルを変更する（id は最新のモデルで採番し直す） */
  const commit = useCallback(
    (ops: ModelOp[], from: UpdateSource = "jev") => {
      commitOps(rebaseOps(modelRef.current, ops, []).ops, from);
    },
    [commitOps],
  );

  /**
   * 「図を分ける」: いまの図を過去の図として退避し、新しい対象業務で図を始める。
   * 登場人物は引き継ぐ。前の図に対する処理（gemma の後続処理・検証待ち）は捨てる。
   */
  const splitDiagram = useCallback((title: string) => {
    const previous = modelRef.current;
    const now = new Date().toISOString();
    setArchives((prev) => [
      ...prev,
      { id: crypto.randomUUID(), title: previous.scope.title, model: previous, closedAt: now },
    ]);
    docRef.current += 1;
    followQueue.current = [];
    pendingRef.current = [];
    signalsRef.current = { analyzed: 0, startedAt: 0, lastActivityAt: 0, grillScore: 0 };
    const fresh = splitModel(previous, title, now);
    modelRef.current = fresh;
    setModel(fresh);
    setSource("manual");
  }, []);

  const getModel = useCallback(() => modelRef.current, []);
  const getSignals = useCallback(() => signalsRef.current, []);

  return {
    model,
    entries,
    source,
    analyze,
    applyScript,
    reset,
    commit,
    archives,
    splitDiagram,
    getModel,
    getSignals,
    pushEntry,
  };
}
