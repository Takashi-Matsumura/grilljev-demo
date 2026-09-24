"use client";

import { useRef, useState } from "react";
import type { FlowModel } from "@/lib/model/types";
import { EXPORT_MIME, exportFileName } from "@/lib/render/export";
import { download } from "./download";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; markdown: string; proseError: string | null }
  | { kind: "error"; message: string };

/** 業務分掌ドキュメント（Markdown）を作って、保存・コピーできるようにする。 */
/**
 * クリップボードへ書く。`navigator.clipboard` は secure context でしか使えないので
 * （`http://<ホストのIP>` で開いた検証環境には無い）、その場合は選択＋execCommand に落とす。
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 権限が無いなど。下の方法を試す
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function SummaryButton({ model, empty }: { model: FlowModel; empty: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  async function open() {
    ref.current?.showModal();
    setState({ kind: "loading" });
    setCopied(false);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = (await res.json()) as { markdown?: string; proseError?: string | null; error?: string };
      if (!res.ok || !data.markdown) throw new Error(data.error ?? "作成に失敗しました");
      setState({ kind: "done", markdown: data.markdown, proseError: data.proseError ?? null });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "作成に失敗しました" });
    }
  }

  const btn =
    "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <>
      <button type="button" className={btn} disabled={empty} onClick={() => void open()} title="図から業務分掌ドキュメント（Markdown）を作ります">
        業務分掌を作る
      </button>
      <dialog ref={ref} className="m-auto w-[min(48rem,92vw)] rounded-lg border border-black/15 bg-white p-4 text-inherit backdrop:bg-black/40 dark:border-white/20 dark:bg-zinc-900">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-medium">業務分掌ドキュメント</h2>
            <button type="button" className={btn} onClick={() => ref.current?.close()}>
              閉じる
            </button>
          </div>
          {state.kind === "loading" && <p className="text-sm text-zinc-500">作成しています…（概要の生成に数秒かかります）</p>}
          {state.kind === "error" && (
            <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
              {state.message}
            </p>
          )}
          {state.kind === "done" && (
            <>
              {state.proseError && (
                <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
                  概要・改善候補は生成できませんでした（{state.proseError}）。表と図はそのまま使えます。
                </p>
              )}
              <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-md bg-zinc-100 p-3 text-xs dark:bg-white/10">
                {state.markdown}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btn}
                  onClick={() => download(exportFileName(model.scope.title, "md"), EXPORT_MIME.md, state.markdown)}
                >
                  ⤓ .md を保存
                </button>
                <button
                  type="button"
                  className={btn}
                  onClick={() => void copyText(state.markdown).then(setCopied)}
                >
                  コピー
                </button>
                {copied && <span className="self-center text-xs text-zinc-500">コピーしました</span>}
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
