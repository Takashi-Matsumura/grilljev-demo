"use client";

import { useState } from "react";
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

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
  const field =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";

  return (
    <aside
      aria-label="ステップの追加"
      className="flex shrink-0 flex-col gap-3 overflow-y-auto border-t border-black/10 p-4 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
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
      <p className="-mt-2 text-xs text-zinc-500">{position}（図の番号を選んでから追加すると、その後に入ります）</p>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
        // 変換を確定する Enter で追加しない（Safari は変換中の Enter でもフォームを送る）
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
        }}
      >
        <label className="flex flex-col gap-1">
          送り手（誰が）
          <select className={field} value={from} onChange={(e) => setFrom(e.target.value)}>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          受け手（誰に）
          <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === from ? `${a.name}（自分の中の作業）` : a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          名前（何をする）
          <input
            autoFocus
            className={field}
            value={label}
            placeholder="例: 請求書を送る"
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          渡すもの（図の帯）
          <input
            className={field}
            value={artifact}
            placeholder="なし（書類・データ・ファイル）"
            onChange={(e) => setArtifact(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} />
          仮のステップにする（点線。まだはっきりしないもの）
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3 dark:border-white/15">
          <button type="submit" className={btn} disabled={!ready}>
            追加
          </button>
          <button
            type="button"
            className={btn}
            disabled={!ready}
            title="追加したあと、受け手を送り手にして次のステップを書きます"
            onClick={() => submit(true)}
          >
            続けて追加
          </button>
        </div>
      </form>
    </aside>
  );
}
