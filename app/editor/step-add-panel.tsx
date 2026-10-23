"use client";

import { useState } from "react";
import { FromToPicker, PanelSection } from "@/app/components/step-panel";
import type { StepInput } from "@/lib/model/add-step";
import type { Branch, FlowModel } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * ステップを手で足すフォーム。ステップの編集（StepPanel）と同じ場所（図の右、狭い画面では下）に出す。
 * 入れる位置は開いたときに決まる（選んでいたステップの直後、無ければ末尾）。
 * 送り手と受け手に同じ人を選ぶと、自分の中で完結する作業（自己ループ）になる。
 */
export function StepAddPanel({
  model,
  afterStepId,
  into,
  initialFrom,
  onAdd,
  onRemoveInto,
  onClose,
}: {
  model: FlowModel;
  /** このステップの直後に入れる。null なら末尾 */
  afterStepId: string | null;
  /** この場合（枠の中）の最後に入れる。afterStepId より優先 */
  into?: Branch;
  /** 渡すと、into の場合が空のときに「この場合を消す」を出す（作った枠をやめたいとき） */
  onRemoveInto?: () => void;
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
  const position = into
    ? `［${into.condition}］の中に入れます`
    : afterIndex >= 0
      ? `${afterIndex + 1} 番の後に入れます`
      : "最後に入れます";
  // 空の場合なら、やめられるようにする（枠の最後の場合なら、枠ごと消える）
  const intoEmpty = into !== undefined && !steps.some((s) => s.branchId === into.id);
  const lastArm = into !== undefined && model.branches.filter((b) => b.groupId === into.groupId).length === 1;
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
      <p
        className={`px-4 pb-2 text-xs ${into ? "text-violet-700 dark:text-violet-300" : "text-zinc-500"}`}
        title={into ? "分岐の枠の中に入れます" : "図の番号を選んでから追加すると、その後に入ります"}
      >
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

            <FromToPicker
              actors={actors}
              from={from}
              to={to}
              onFrom={setFrom}
              onTo={setTo}
              onSwap={() => {
                setFrom(to);
                setTo(from);
              }}
            />

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

          {/* ここより上がステップに要る最低限（内容・誰が・誰に・渡すもの）。下は必要なときだけ */}
          <hr className="border-black/10 dark:border-white/15" />
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
          {intoEmpty && onRemoveInto && (
            <button
              type="button"
              className="mr-auto rounded-md px-2 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
              title={lastArm ? "中にステップが無いこの枠を消します" : "中にステップが無いこの場合を消します"}
              onClick={onRemoveInto}
            >
              {lastArm ? "この枠を消す" : "この場合を消す"}
            </button>
          )}
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
const field = "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
