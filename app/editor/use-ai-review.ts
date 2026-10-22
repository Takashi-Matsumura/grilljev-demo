"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FlowModel } from "@/lib/model/types";
import type { Finding } from "@/lib/review/rules";

/** どの図の内容に対する点検か。図の中身（登場人物・手順・分岐・前提）が変わったら、結果は古い */
export function reviewKey(model: FlowModel, name: string): string {
  return JSON.stringify([name, model.scope, model.actors, model.steps, model.branches]);
}

export type AiReviewState =
  | { status: "idle" }
  | { status: "loading"; for: string }
  | { status: "done"; for: string; findings: Finding[]; summary: string | null }
  | { status: "error"; for: string; message: string };

/**
 * AI による点検（/api/review）。30〜60 秒かかるので、パネルを閉じても結果を持っておく（エディタが持つ）。
 * 走っている途中で次を頼んだら、前のものは捨てる。
 */
export function useAiReview() {
  const [state, setState] = useState<AiReviewState>({ status: "idle" });
  const ctrlRef = useRef<AbortController | null>(null);

  const run = useCallback((model: FlowModel, name: string, already: string[]) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const key = reviewKey(model, name);
    setState({ status: "loading", for: key });
    fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, title: name, already }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          findings?: Finding[];
          summary?: string | null;
          error?: string;
        };
        setState(
          res.ok && json.findings
            ? { status: "done", for: key, findings: json.findings, summary: json.summary ?? null }
            : { status: "error", for: key, message: json.error ?? `HTTP ${res.status}` },
        );
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", for: key, message: e instanceof Error ? e.message : "通信に失敗しました" });
      });
  }, []);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  return { state, run };
}
