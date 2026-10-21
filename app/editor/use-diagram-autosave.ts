"use client";

import { useEffect, useRef, useState } from "react";
import type { SaveStatus } from "@/app/components/use-autosave";
import type { FlowModel } from "@/lib/model/types";

const DEBOUNCE_MS = 1_500;

/**
 * 図を、変更のあとしばらく静かになってから自動保存する（会議の use-autosave と同じ作り）。
 * - 保存は 1 本ずつ（前の保存が終わってから次を送る。古い内容が新しい内容を上書きしない）
 * - 開いた直後（読み込んだ内容そのまま）は保存しない
 * - 失敗したら「保存できていない」を表示し、次の変更でまた試す
 */
export function useDiagramAutosave(slug: string, model: FlowModel) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const first = useRef(true);
  const latest = useRef(model);
  const inflight = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    latest.current = model;
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
          const res = await fetch(`/api/diagrams/${slug}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: latest.current }),
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
  }, [slug, model]);

  return status;
}
