"use client";

import { useCallback, useEffect, useRef } from "react";
import type { FacilitateResponse } from "@/app/api/facilitate/route";
import { buildAskOps } from "@/lib/facilitator/ops";
import { purposeMissing } from "@/lib/facilitator/purpose";
import { RETRY_ERROR_MS, RETRY_HOLD_MS, shouldTrigger } from "@/lib/facilitator/trigger";
import type { FlowModel, ModelOp } from "@/lib/model/types";
import { clock } from "@/lib/transcript/line";
import type { UpdateSource } from "./diagram-pane";
import type { ConsoleEntry } from "./jev-console";
import type { Signals } from "./use-pipeline";
import { newId } from "@/lib/id";

const CHECK_INTERVAL_MS = 2_000;

type Options = {
  /** 自動問いかけ ON/OFF。バックエンドの状態ダイアログのトグルが由来（use-facilitator-auto.ts） */
  auto: boolean;
  getModel: () => FlowModel;
  getSignals: () => Signals;
  /** 直近の業務の発言（古い順）。問いの生成と選別の文脈に使う */
  getRecent: () => string[];
  commit: (ops: ModelOp[], from?: UpdateSource) => void;
  pushEntry: (entry: ConsoleEntry) => void;
};

/**
 * ファシリテーター。gemma が問いの候補を書き、Jev が「いま出すべき 1 問」を選ぶ（/api/facilitate）。
 * 自動（`auto`）では、前回から一定時間あいていて、間が空いた・論点が溜まったなどのときに動く
 * （lib/facilitator/trigger.ts）。出せるのは 1 度に 1 問。出したあと答え・保留になるまでは、次を生成しない。
 * 生成された問いそのものは model.issues に入り、画面には図の上のフローティングカード
 * （facilitator-overlay.tsx）が出す。
 */
export function useFacilitator({ auto, getModel, getSignals, getRecent, commit, pushEntry }: Options) {
  const busyRef = useRef(false);
  const epochRef = useRef(0);
  const lastAskedAtRef = useRef(0);
  const nextEligibleAtRef = useRef(0);

  const generate = useCallback(
    async (force: boolean) => {
      if (busyRef.current) return;
      const before = getModel();
      const sig = getSignals();
      // 1 度に 1 問。手動（force）でも、質問中に重ねて出さない（別の問いにするときは先に保留にする）
      if (before.issues.some((i) => i.status === "asked")) return;

      busyRef.current = true;
      const epoch = epochRef.current;
      try {
        const res = await fetch("/api/facilitate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: before,
            recent: getRecent(),
            force,
            // 最後の発言から何秒経ったか。Jev が「いま割り込んでよいか」を判断する材料
            silenceSec: sig.analyzed > 0 ? (Date.now() - sig.lastActivityAt) / 1000 : null,
          }),
        });
        const json = (await res.json()) as FacilitateResponse & { error?: string };
        if (epoch !== epochRef.current) return;

        if (!res.ok || json.error) {
          nextEligibleAtRef.current = Date.now() + RETRY_ERROR_MS;
          return;
        }

        if (json.exchange) {
          pushEntry({
            id: newId(),
            at: clock(),
            utterance: "問いかけの選別",
            kind: "facilitator",
            exchange: json.exchange,
            note: `${json.summary}（gemma ${json.gemmaMs}ms${json.suggestMs !== undefined ? ` + 推奨回答 ${json.suggestMs}ms` : ""}）`,
          });
        }

        if (json.status === "ask" && json.chosen) {
          // 適用する瞬間の最新モデルで作る（生成中に論点が答えられているかもしれない）
          commit(buildAskOps(getModel(), json.chosen), "jev");
          lastAskedAtRef.current = Date.now();
          nextEligibleAtRef.current = 0;
        } else {
          nextEligibleAtRef.current = Date.now() + RETRY_HOLD_MS;
        }
      } catch {
        if (epoch !== epochRef.current) return;
        nextEligibleAtRef.current = Date.now() + RETRY_ERROR_MS;
      } finally {
        busyRef.current = false;
      }
    },
    [commit, getModel, getRecent, getSignals, pushEntry],
  );

  // 自動: 一定間隔で「いま出してよいか」を見る。実際に出すかは Jev の判断（黙ることもある）。
  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      const model = getModel();
      const sig = getSignals();
      const ok = shouldTrigger({
        now: Date.now(),
        hasAsked: model.issues.some((i) => i.status === "asked"),
        analyzed: sig.analyzed,
        startedAt: sig.startedAt,
        lastActivityAt: sig.lastActivityAt,
        lastAskedAt: lastAskedAtRef.current,
        nextEligibleAt: nextEligibleAtRef.current,
        grillScore: sig.grillScore,
        purposeMissing: purposeMissing(model),
        openIssues: model.issues.filter((i) => i.status === "open").length,
      });
      if (ok) void generate(false);
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auto, generate, getModel, getSignals]);

  const reset = useCallback(() => {
    epochRef.current += 1;
    lastAskedAtRef.current = 0;
    nextEligibleAtRef.current = 0;
    busyRef.current = false;
  }, []);

  return { generate, reset };
}
