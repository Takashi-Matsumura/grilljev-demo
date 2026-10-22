"use client";

import { useState } from "react";
import { PanelSection } from "@/app/components/step-panel";
import type { StepInput } from "@/lib/model/add-step";
import type { FlowModel } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * ステップを手で足すフォーム。ステップの編集（StepPanel）と同じ場所（図の右、狭い画面では下）に出す。
 * 入れる位置は開いたときに決まる（選んでいたステップの直後、無ければ末尾）。
 * 送り手と受け手に同じ人を選ぶと、自分の中で完結する作業（自己ループ）になる。
 */
export function StepAddPanel({
  model,
  afterStepId,
  initialFrom,
  onAdd,
  onClose,
}: {
  model: FlowModel;
  /** このステップの直後に入れる。null なら末尾 */
  afterStepId: string | null;
  /** 送り手の初期値（「続けて追加」では、前のステップの受け手） */
  initialFrom?: string;
  /** again: 「続けて追加」で押した */
  onAdd: (input: StepInput, again: boolean) => void;
  onClose: () => void;
}) {
  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);
  const fromDefault = actors.some((a) => a.id === initialFrom) ? initialFrom! : (actors[0]?.id ?? "");
  // 受け手の初期値は、送り手の右隣（右端なら左隣、1 人だけなら本人）
  const toDefault = (from: string) => {
    const i = actors.findIndex((a) => a.id === from);
    return (actors[i + 1] ?? actors[i - 1] ?? actors[i])?.id ?? "";
  };
  const [from, setFrom] = useState(fromDefault);
  const [to, setTo] = useState(() => toDefault(fromDefault));
  const [label, setLabel] = useState("");
  const [artifact, setArtifact] = useState("");
  const [provisional, setProvisional] = useState(false);

  const steps = visibleSteps(model);
  const afterIndex = afterStepId ? steps.findIndex((s) => s.id === afterStepId) : -1;
  const position = afterIndex >= 0 ? `${afterIndex + 1} 番の後に入れます` : "最後に入れます";
  const ready = label.trim() !== "" && from !== "" && to !== "";
  const submit = (again: boolean) => {
    if (ready) onAdd({ from, to, label, artifact, provisional }, again);
  };

  return (
    <aside
      aria-label="ステップの追加"
      className="flex shrink-0 flex-col border-t border-black/10 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium">ステップの追加</h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="px-4 pb-2 text-xs text-zinc-500" title="図の番号を選んでから追加すると、その後に入ります">
        {position}
      </p>

      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        // 変換を確定する Enter で追加しない（Safari は変換中の Enter でもフォームを送る）
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-2">
          <PanelSection title="内容">
            <input
              autoFocus
              aria-label="ステップの名前"
              className={field}
              value={label}
              placeholder="何をする（例: 請求書を送る）"
              onChange={(e) => setLabel(e.target.value)}
            />

            {/* 誰が → 誰に。同じ人なら自分の中の作業（自己ループ） */}
            <div className="flex items-center gap-1.5">
              <select
                aria-label="送り手（誰が）"
                className={`${field} min-w-0 flex-1`}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              >
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <span aria-hidden className="text-zinc-400">
                →
              </span>
              <select
                aria-label="受け手（誰に）"
                className={`${field} min-w-0 flex-1`}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                {actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id === from ? `${a.name}（自分）` : a.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={iconBtn}
                aria-label="送り手と受け手を入れ替える"
                title="送り手と受け手を入れ替える"
                disabled={from === to}
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
              >
                ⇄
              </button>
            </div>

            <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
              <span className="text-xs text-zinc-500">渡すもの</span>
              <input
                className={field}
                value={artifact}
                placeholder="なし（書類・データ）"
                title="図の帯になります"
                onChange={(e) => setArtifact(e.target.value)}
              />
            </label>
          </PanelSection>

          <PanelSection title="状態">
            <div className="flex items-center gap-3">
              <div
                role="group"
                aria-label="確定か仮か"
                className="inline-flex rounded-md border border-black/15 p-0.5 dark:border-white/20"
              >
                {(
                  [
                    ["確定", false],
                    ["仮", true],
                  ] as const
                ).map(([text, value]) => (
                  <button
                    key={text}
                    type="button"
                    aria-pressed={provisional === value}
                    className="rounded px-3 py-1 text-sm text-zinc-600 aria-pressed:bg-sky-600 aria-pressed:text-white dark:text-zinc-300"
                    onClick={() => setProvisional(value)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <span className="text-xs text-zinc-500">
                {provisional ? "点線で描きます（まだはっきりしないもの）" : "実線で描きます"}
              </span>
            </div>
          </PanelSection>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-black/10 px-4 py-3 dark:border-white/15">
          <button
            type="button"
            className={btn}
            disabled={!ready}
            title="追加したあと、受け手を送り手にして次のステップを書きます"
            onClick={() => submit(true)}
          >
            続けて追加
          </button>
          <button
            type="submit"
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-700 disabled:opacity-40 disabled:hover:bg-sky-600"
            disabled={!ready}
          >
            追加
          </button>
        </div>
      </form>
    </aside>
  );
}

const btn =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/15 hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";
const field = "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
