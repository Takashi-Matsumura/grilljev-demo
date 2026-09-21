"use client";

import { useEffect, useRef, useState } from "react";
import type { ArchivedDiagram } from "@/lib/scope/apply";
import type { FlowModel } from "@/lib/model/types";
import type { Line } from "@/lib/transcript/line";

export type SaveStatus = "saved" | "saving" | "error";

const DEBOUNCE_MS = 1_500;

/**
 * 会議の中身を、変更のあとしばらく静かになってから自動保存する。
 * - 保存は 1 本ずつ（前の保存が終わってから次を送る。古い内容が新しい内容を上書きしない）
 * - 開いた直後（読み込んだ内容そのまま）は保存しない
 * - 失敗したら「保存できていない」を表示し、次の変更でまた試す
 */
export function useAutosave(slug: string, model: FlowModel, archives: ArchivedDiagram[], lines: Line[]) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const first = useRef(true);
  const latest = useRef({ model, archives, lines });
  const inflight = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    latest.current = { model, archives, lines };
    if (first.current) {
      first.current = false;
      return;
    }
    dirty.current = true;
    setStatus("saving");

    async function flush() {
      if (inflight.current) return; // 終わったら dirty を見て続ける
      inflight.current = true;
      try {
        while (dirty.current) {
          dirty.current = false;
          const res = await fetch(`/api/sessions/${slug}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(latest.current),
          });
          if (!res.ok) throw new Error(String(res.status));
        }
        setStatus("saved");
      } catch {
        dirty.current = true;
        setStatus("error");
      } finally {
        inflight.current = false;
      }
    }

    const timer = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [slug, model, archives, lines]);

  return status;
}
