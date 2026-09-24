"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScopeShiftResponse } from "@/app/api/scope-shift/route";
import type { Interpretation } from "@/lib/analysis/interpret";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { renameOps } from "@/lib/scope/apply";
import {
  SHIFT_COOLDOWN_MS,
  SHIFT_DISMISS_COOLDOWN_MS,
  SHIFT_KEEP_COOLDOWN_MS,
  pushDrift,
  shouldPropose,
  type DriftPoint,
  type ShiftRelation,
} from "@/lib/scope/drift";
import type { TitleCandidate } from "@/lib/scope/pick";
import { clock } from "@/lib/transcript/line";
import type { UpdateSource } from "./diagram-pane";
import type { ConsoleEntry } from "./jev-console";
import type { AnalysisJob } from "./use-pipeline";
import { newId } from "@/lib/id";

const RECENT_BUSINESS = 4;

/** 参加者に確認する、対象業務の変更案 */
export type ShiftProposal = {
  id: string;
  relation: ShiftRelation;
  currentTitle: string;
  title: string;
  reason: string;
  /** この提案のきっかけになった直近の発言 */
  evidence: string;
  moved: number | null;
  alternatives: TitleCandidate[];
};

export type ShiftStatus = { kind: "idle" | "checking" | "error"; message: string };

type Options = {
  getModel: () => FlowModel;
  commit: (ops: ModelOp[], from?: UpdateSource) => void;
  splitDiagram: (title: string) => void;
  pushEntry: (entry: ConsoleEntry) => void;
};

/**
 * 対象業務（共通認識）が会話の中で変わったときの検知と提案。
 *
 * 判定した発話ごとに scope_drift を窓（3 件）に積み、平均が高く、ズレの種類が 2 件以上で一致したら
 * gemma に新しい業務名を書かせ、Jev が絞る（/api/scope-shift）。**自動では絶対に変えない**:
 * 提案をバナーで見せ、参加者が選んだ操作だけがモデルに入る。
 */
export function useScopeShift({ getModel, commit, splitDiagram, pushEntry }: Options) {
  const [proposal, setProposal] = useState<ShiftProposal | null>(null);
  const [status, setStatus] = useState<ShiftStatus>({ kind: "idle", message: "" });

  const windowRef = useRef<DriftPoint[]>([]);
  const recentRef = useRef<string[]>([]);
  const cooldownUntilRef = useRef(0);
  const busyRef = useRef(false);
  const proposalRef = useRef<ShiftProposal | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    proposalRef.current = proposal;
  });

  const propose = useCallback(
    async (relation: ShiftRelation) => {
      busyRef.current = true;
      const epoch = epochRef.current;
      const model = getModel();
      const recent = recentRef.current.slice(-RECENT_BUSINESS);
      setStatus({ kind: "checking", message: "話題が変わったか確認中…" });
      try {
        const res = await fetch("/api/scope-shift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, recent, relation }),
        });
        const json = (await res.json()) as ScopeShiftResponse & { error?: string };
        if (epoch !== epochRef.current) return;
        if (!res.ok || json.error) {
          cooldownUntilRef.current = Date.now() + SHIFT_KEEP_COOLDOWN_MS;
          setStatus({ kind: "error", message: json.error ?? `HTTP ${res.status}` });
          return;
        }

        pushEntry({
          id: newId(),
          at: clock(),
          utterance: "対象業務の変化の確認",
          kind: "scope",
          exchange: json.exchange,
          note: `${json.summary}（gemma ${json.gemmaMs}ms）`,
        });

        windowRef.current = []; // 同じ根拠で連続して提案しない
        if (json.status === "propose" && json.chosen) {
          cooldownUntilRef.current = Date.now() + SHIFT_COOLDOWN_MS;
          setProposal({
            id: newId(),
            relation,
            currentTitle: model.scope.title,
            title: json.chosen.title,
            reason: json.chosen.reason,
            evidence: recent[recent.length - 1] ?? "",
            moved: json.moved,
            alternatives: json.candidates.filter((c) => c.id !== json.chosen?.id),
          });
          setStatus({ kind: "idle", message: "" });
        } else {
          // Jev が「現状のまま」と判断した（誤検知）。しばらく聞き直さない
          cooldownUntilRef.current = Date.now() + SHIFT_KEEP_COOLDOWN_MS;
          setStatus({ kind: "idle", message: "" });
        }
      } catch (e) {
        if (epoch !== epochRef.current) return;
        cooldownUntilRef.current = Date.now() + SHIFT_KEEP_COOLDOWN_MS;
        setStatus({ kind: "error", message: e instanceof Error ? e.message : "確認に失敗しました" });
      } finally {
        busyRef.current = false;
      }
    },
    [getModel, pushEntry],
  );

  /** 1 発話の判定が済むたびに呼ぶ。雑談はズレの根拠にしない。 */
  const observe = useCallback(
    (interpretation: Interpretation, job: AnalysisJob) => {
      if (interpretation.verdict === "drop") return;
      recentRef.current = [...recentRef.current, job.text].slice(-RECENT_BUSINESS);
      windowRef.current = pushDrift(windowRef.current, {
        drift: interpretation.driftSignal,
        relation: interpretation.scopeRelation,
      });
      const relation = shouldPropose({
        window: windowRef.current,
        now: Date.now(),
        cooldownUntil: cooldownUntilRef.current,
        busy: busyRef.current || proposalRef.current !== null,
      });
      if (relation) void propose(relation);
    },
    [propose],
  );

  const close = useCallback((cooldownMs: number) => {
    setProposal(null);
    windowRef.current = [];
    cooldownUntilRef.current = Date.now() + cooldownMs;
  }, []);

  /** 「図を分ける」: いまの図を過去の図にして、新しい対象業務で始める */
  const split = useCallback(() => {
    if (!proposal) return;
    splitDiagram(proposal.title);
    close(SHIFT_COOLDOWN_MS);
  }, [proposal, splitDiagram, close]);

  /** 「対象を差し替える / 広げる」: 図はそのまま、対象業務の名前だけを変える */
  const rename = useCallback(() => {
    if (!proposal) return;
    commit(renameOps(proposal.title), "manual");
    close(SHIFT_COOLDOWN_MS);
  }, [proposal, commit, close]);

  /** 「同じ業務として続ける」: 何も変えない。しばらく（5 分）この提案を出さない */
  const dismiss = useCallback(() => close(SHIFT_DISMISS_COOLDOWN_MS), [close]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    busyRef.current = false;
    windowRef.current = [];
    recentRef.current = [];
    cooldownUntilRef.current = 0;
    setProposal(null);
    setStatus({ kind: "idle", message: "" });
  }, []);

  return { proposal, status, observe, split, rename, dismiss, reset };
}
