"use client";

import { useState, type ReactNode } from "react";
import { moveStepOps } from "@/lib/model/move";
import type { Actor, FlowModel, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";

/**
 * 図の番号をクリックしたときに、図の横（狭い画面では下）に開く、ステップの手直し。
 * 人は言い間違えるので、音声で足したステップを、名前・送り手・受け手・確定/仮・順番・削除で直せるようにする。
 *
 * 図を覆わない（モーダルにしない）。選んだステップは図で強調するので、順番を動かすと強調ごと動くのが見える。
 * 変更はその場で反映する（名前は入力を確定したとき＝Enter かフォーカスを外したとき）。
 */
export function StepPanel({
  model,
  stepId,
  onClose,
  onCommit,
  onFocus,
  children,
}: {
  model: FlowModel;
  /** 開いているステップ。図に無ければ何も出さない */
  stepId: string;
  onClose: () => void;
  onCommit: (ops: ModelOp[]) => void;
  /** 渡すと「声で直す」を出す。このステップを、番号を言わずに音声で直す対象にする */
  onFocus?: (stepId: string) => void;
  /** 「状態」の下に足す欄（/editor の分岐の操作など）。PanelSection で包むと見た目が揃う */
  children?: ReactNode;
}) {
  const steps = visibleSteps(model);
  const index = steps.findIndex((s) => s.id === stepId);
  const step = index >= 0 ? steps[index] : null;
  // 名前の書きかけ。別のステップに切り替わる・外から名前が変わったら、今の名前から書き直す
  const [draft, setDraft] = useState<{ for: string; label: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [assigneeDraft, setAssigneeDraft] = useState<{ for: string; text: string } | null>(null);
  const [artifactDraft, setArtifactDraft] = useState<{ for: string; text: string } | null>(null);
  if (!step) return null;

  const label = draft?.for === `${step.id}:${step.label}` ? draft.label : step.label;
  const update = (patch: Extract<ModelOp, { op: "step.update" }>["patch"]) =>
    onCommit([{ op: "step.update", id: step.id, patch }]);
  const commitLabel = () => {
    const next = label.replace(/\s+/g, " ").trim();
    setDraft(null);
    if (next !== "" && next !== step.label) update({ label: next });
  };
  const sender = model.actors.find((a) => a.id === step.from);
  // 担当者を書けるのは、送り手が部署・社外のとき（個人・システムは、それ自体が担当）
  const canAssign = sender !== undefined && sender.kind !== "person" && sender.kind !== "system";
  const assigneeKey = `${step.id}:${step.assignee ?? ""}`;
  const assignee = assigneeDraft?.for === assigneeKey ? assigneeDraft.text : (step.assignee ?? "");
  /** 担当者を確定する。部署のメンバーにいない名前なら、メンバーにも加える（次から候補に出る） */
  const commitAssignee = () => {
    setAssigneeDraft(null);
    if (!sender) return;
    const next = assignee.replace(/\s+/g, " ").trim().replace(/(さん|様|氏)$/, "");
    if (next === (step.assignee ?? "")) return;
    const ops: ModelOp[] = [{ op: "step.update", id: step.id, patch: { assignee: next === "" ? undefined : next } }];
    const members = sender.members ?? [];
    if (next !== "" && !members.includes(next)) {
      ops.push({ op: "actor.update", id: sender.id, patch: { members: [...members, next] } });
    }
    onCommit(ops);
  };
  // 渡すもの（図の帯）。空にすると帯を外す。手で書いたものは、登場人物の名前でもそのまま使う
  const artifactKey = `${step.id}:${step.artifact ?? ""}`;
  const artifact = artifactDraft?.for === artifactKey ? artifactDraft.text : (step.artifact ?? "");
  const commitArtifact = () => {
    setArtifactDraft(null);
    const next = artifact.replace(/\s+/g, " ").trim();
    if (next !== (step.artifact ?? "")) update({ artifact: next === "" ? undefined : next });
  };
  /** 送り手を変えたら、新しい送り手のメンバーでない担当者は外す（別の部署の人が担当にならないように） */
  const changeSender = (id: string) => {
    const members = model.actors.find((a) => a.id === id)?.members ?? [];
    const keep = step.assignee !== undefined && members.includes(step.assignee);
    update(keep ? { from: id } : { from: id, assignee: undefined });
  };
  /** 送り手と受け手を入れ替える。担当者は新しい送り手のメンバーなら残す */
  const swap = () => {
    const members = model.actors.find((a) => a.id === step.to)?.members ?? [];
    const keep = step.assignee !== undefined && members.includes(step.assignee);
    update(keep ? { from: step.to, to: step.from } : { from: step.to, to: step.from, assignee: undefined });
  };
  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);
  const confirmed = step.status === "confirmed";

  return (
    <aside
      aria-label="ステップの編集"
      className="flex shrink-0 flex-col border-t border-black/10 text-sm lg:w-80 lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className="font-medium">
          <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-600 px-1.5 text-xs text-white">
            {index + 1}
          </span>
          ステップの編集
        </h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4 pt-2">
        <PanelSection title="内容">
          <input
            aria-label="ステップの名前"
            className={field}
            value={label}
            placeholder="何をする"
            onChange={(e) => setDraft({ for: `${step.id}:${step.label}`, label: e.target.value })}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) commitLabel();
            }}
          />

          <FromToPicker
            actors={actors}
            from={step.from}
            to={step.to}
            onFrom={changeSender}
            onTo={(id) => update({ to: id })}
            onSwap={swap}
          />

          <label className={row}>
            <span className={rowLabel}>渡すもの</span>
            <input
              className={field}
              value={artifact}
              placeholder="なし（書類・データ）"
              title="図の帯になります"
              onChange={(e) => setArtifactDraft({ for: artifactKey, text: e.target.value })}
              onBlur={commitArtifact}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) commitArtifact();
              }}
            />
          </label>

          {canAssign && (
            <label className={row}>
              <span className={rowLabel}>担当者</span>
              <input
                className={field}
                value={assignee}
                list={`members-${sender.id}`}
                placeholder="未設定"
                title={`${sender.name}の中で、実際にやる人`}
                onChange={(e) => setAssigneeDraft({ for: assigneeKey, text: e.target.value })}
                onBlur={commitAssignee}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) commitAssignee();
                }}
              />
              <datalist id={`members-${sender.id}`}>
                {(sender.members ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}
        </PanelSection>

        {/* ここより上がステップの中身（内容・誰が・誰に・渡すもの）。下は状態・順番など */}
        <hr className="border-black/10 dark:border-white/15" />
        <PanelSection title="状態">
          <div className="flex items-center gap-3">
            <div role="group" aria-label="確定か仮か" className="inline-flex rounded-md border border-black/15 p-0.5 dark:border-white/20">
              {/* 「確定」にしたら実線・確信度 1 にする（要対応の承認と同じ扱い）。「仮」は点線 */}
              {(
                [
                  ["確定", true],
                  ["仮", false],
                ] as const
              ).map(([text, value]) => (
                <button
                  key={text}
                  type="button"
                  aria-pressed={confirmed === value}
                  className="rounded px-3 py-1 text-sm text-zinc-600 aria-pressed:bg-sky-600 aria-pressed:text-white dark:text-zinc-300"
                  onClick={() =>
                    confirmed !== value &&
                    update(value ? { status: "confirmed", confidence: 1 } : { status: "provisional" })
                  }
                >
                  {text}
                </button>
              ))}
            </div>
            <span className="text-xs text-zinc-500">{confirmed ? "実線で描きます" : "点線で描きます"}</span>
          </div>
        </PanelSection>

        {children}
      </div>

      <div className="flex items-center gap-1.5 border-t border-black/10 px-4 py-3 dark:border-white/15">
        <span className="mr-0.5 text-xs text-zinc-500">順番</span>
        <button
          type="button"
          className={iconBtn}
          aria-label="前へ"
          title="前へ（図の番号やステップ名をドラッグしても並べ替えられます）"
          disabled={index === 0}
          onClick={() => onCommit(moveStepOps(steps, index, index - 1))}
        >
          ↑
        </button>
        <button
          type="button"
          className={iconBtn}
          aria-label="後へ"
          title="後へ（図の番号やステップ名をドラッグしても並べ替えられます）"
          disabled={index === steps.length - 1}
          onClick={() => onCommit(moveStepOps(steps, index, index + 2))}
        >
          ↓
        </button>
        {onFocus && (
          <button
            type="button"
            className={btn}
            title="このステップを、番号を言わずに声で直せるようにします"
            onClick={() => {
              onFocus(step.id);
              onClose();
            }}
          >
            声で直す
          </button>
        )}
        <span className="flex-1" />
        {confirmingDelete === step.id ? (
          <>
            <button type="button" className={btn} onClick={() => setConfirmingDelete(null)}>
              やめる
            </button>
            <button
              type="button"
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700"
              onClick={() => {
                onCommit([{ op: "step.retract", id: step.id }]);
                onClose();
              }}
            >
              削除する
            </button>
          </>
        ) : (
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
            onClick={() => setConfirmingDelete(step.id)}
          >
            削除
          </button>
        )}
      </div>
    </aside>
  );
}

const btn =
  "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";
const iconBtn =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/15 hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10";
const field = "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
const row = "grid grid-cols-[4.5rem_1fr] items-center gap-2";
const rowLabel = "text-xs text-zinc-500";

/**
 * 送り手と受け手。欄は向きに関わらず「誰が」「誰に」の順に上下で固定する（図の左右に合わせて欄を入れ替えると、
 * 右から左へ渡すステップで、どちらがどちらか分からなくなる）。図での向きは、下の小さなレーンの帯で示す。
 * 同じ人なら自分の中の作業（自己ループ）
 */
export function FromToPicker({
  actors,
  from,
  to,
  onFrom,
  onTo,
  onSwap,
}: {
  /** ライフラインの順（左から）に並べたもの */
  actors: Actor[];
  from: string;
  to: string;
  onFrom: (id: string) => void;
  onTo: (id: string) => void;
  onSwap: () => void;
}) {
  const self = from === to;
  const picker = (side: "from" | "to") => (
    <label className={row}>
      <span className={`${rowLabel} leading-tight`}>
        {side === "from" ? "誰が" : "誰に"}
        <span className="block text-[10px] text-zinc-400">{side === "from" ? "送り手" : "受け手"}</span>
      </span>
      <select
        className={`${field} min-w-0`}
        value={side === "from" ? from : to}
        onChange={(e) => (side === "from" ? onFrom(e.target.value) : onTo(e.target.value))}
      >
        {actors.map((a) => (
          <option key={a.id} value={a.id}>
            {side === "to" && a.id === from ? `${a.name}（自分）` : a.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {picker("from")}
          {picker("to")}
        </div>
        <button
          type="button"
          className={iconBtn}
          aria-label="送り手と受け手を入れ替える"
          title="送り手と受け手を入れ替える（矢印の向きが逆になります）"
          disabled={self}
          onClick={onSwap}
        >
          ⇅
        </button>
      </div>
      <LaneStrip actors={actors} from={from} to={to} />
    </div>
  );
}

/**
 * 図での向きを示す、小さなレーンの帯。登場人物を図と同じ左右の順に並べ、送り手から受け手へ矢印を引く。
 * 送り手は塗り、受け手は枠で示す。自分の中の作業なら、その人に ↻ を付ける
 */
function LaneStrip({ actors, from, to }: { actors: Actor[]; from: string; to: string }) {
  const n = actors.length;
  const a = actors.findIndex((x) => x.id === from);
  const b = actors.findIndex((x) => x.id === to);
  if (n === 0 || a < 0 || b < 0) return null;
  const center = (i: number) => ((i + 0.5) / n) * 100;
  const left = Math.min(center(a), center(b));
  const width = Math.abs(center(a) - center(b));
  const toRight = b > a;
  const sender = actors[a].name;
  const receiver = actors[b].name;
  return (
    <div
      role="img"
      aria-label={a === b ? `図では、${sender}の中の作業になります` : `図では、${sender}から${receiver}へ${toRight ? "右" : "左"}向きの矢印になります`}
      className="rounded-md bg-zinc-50 px-1 pb-1.5 pt-1 dark:bg-white/5"
    >
      <div className="flex">
        {actors.map((x, i) => (
          <span
            key={x.id}
            title={x.name}
            className={`mx-0.5 min-w-0 flex-1 truncate rounded px-0.5 text-center text-[10px] leading-4 ${
              i === a
                ? "bg-sky-600 font-semibold text-white dark:bg-sky-500"
                : i === b
                  ? "font-semibold text-sky-700 ring-1 ring-sky-600 ring-inset dark:text-sky-300 dark:ring-sky-400"
                  : "text-zinc-400"
            }`}
          >
            {x.name}
          </span>
        ))}
      </div>
      <div aria-hidden className="relative mt-1 h-3">
        {a === b ? (
          <span
            className="absolute -translate-x-1/2 text-xs leading-3 text-sky-600 dark:text-sky-400"
            style={{ left: `${center(a)}%` }}
          >
            ↻
          </span>
        ) : (
          <span className="absolute top-1/2 h-px bg-sky-600 dark:bg-sky-400" style={{ left: `${left}%`, width: `${width}%` }}>
            {/* 矢じりは受け手の側に */}
            <span
              className={`absolute top-1/2 h-0 w-0 -translate-y-1/2 border-y-4 border-y-transparent ${
                toRight
                  ? "right-0 border-l-[6px] border-l-sky-600 dark:border-l-sky-400"
                  : "left-0 border-r-[6px] border-r-sky-600 dark:border-r-sky-400"
              }`}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** 編集パネルの中の一区切り（内容・状態・分岐など）。見出しを小さく出す */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}
