"use client";

import { useEffect, useState, type ReactNode } from "react";
import { moveStepOps } from "@/lib/model/move";
import type { Actor, FlowModel, MessageKind, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";
import { NotesSection } from "./notes-section";

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
  onPreview,
  onFocus,
  children,
}: {
  model: FlowModel;
  /** 開いているステップ。図に無ければ何も出さない */
  stepId: string;
  onClose: () => void;
  onCommit: (ops: ModelOp[]) => void;
  /**
   * 書きかけ（名前・渡すもの・担当者）を、確定する前に図へ映すための ops（無ければ null）。
   * 確定は今までどおり Enter か欄を離れたとき（1 文字ごとに元に戻すの履歴を積まないように）
   */
  onPreview?: (ops: ModelOp[] | null) => void;
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

  // 書きかけを図へ映す。確定（draft が null に戻る）・別のステップへの切り替え・閉じるで外す
  const clean = (v: string) => v.replace(/\s+/g, " ").trim();
  const previewLabel = step && draft?.for === `${step.id}:${step.label}` ? clean(draft.label) : null;
  const previewArtifact = step && artifactDraft?.for === `${step.id}:${step.artifact ?? ""}` ? clean(artifactDraft.text) : null;
  const previewAssignee =
    step && assigneeDraft?.for === `${step.id}:${step.assignee ?? ""}`
      ? clean(assigneeDraft.text).replace(/(さん|様|氏)$/, "")
      : null;
  const previewId = step?.id;
  useEffect(() => {
    if (!onPreview || !previewId) return;
    const patch: Extract<ModelOp, { op: "step.update" }>["patch"] = {};
    // 空の名前は確定しない（commitLabel）ので、映さない
    if (previewLabel) patch.label = previewLabel;
    if (previewArtifact !== null) patch.artifact = previewArtifact || undefined;
    if (previewAssignee !== null) patch.assignee = previewAssignee || undefined;
    onPreview(Object.keys(patch).length > 0 ? [{ op: "step.update", id: previewId, patch }] : null);
  }, [onPreview, previewId, previewLabel, previewArtifact, previewAssignee]);
  useEffect(() => () => onPreview?.(null), [onPreview]);

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
            number={index + 1}
            artifact={artifact}
            onFrom={changeSender}
            onTo={(id) => update({ to: id })}
            onSwap={swap}
          />

          {step.from !== step.to && (
            <ArrowKindPicker kind={step.kind} onChange={(kind) => update({ kind })} />
          )}

          <label className={row}>
            <span className={rowLabel}>渡すもの</span>
            <input
              className={artifactField(artifact.trim() !== "")}
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

          {/* 承認者（責任分担表の A）。図には出さず、業務分掌に使う。システムは責任を持たないので選べない */}
          <label className={row}>
            <span className={rowLabel}>承認者</span>
            <select
              className={field}
              value={step.approver ?? ""}
              title="この手順の結果に責任を持ち、承認・判断する部署・人（業務分掌の責任分担表で A になります）"
              onChange={(e) => update({ approver: e.target.value || undefined })}
            >
              <option value="">なし</option>
              {actors
                .filter((a) => a.kind !== "system")
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id === step.from ? `${a.name}（行う人と同じ）` : a.name}
                  </option>
                ))}
            </select>
          </label>
        </PanelSection>

        {/* ここより上がステップの中身（内容・誰が・誰に・渡すもの）。下は状態・順番など */}
        <hr className="border-black/10 dark:border-white/15" />
        {/* 付箋は、ステップの中身のすぐ下に（下の方だと見つけにくかった） */}
        <NotesSection model={model} target={{ kind: "step", id: step.id }} onCommit={onCommit} />

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
/**
 * 渡すものの欄。図の付箋（Mermaid の Note の黄色い帯）と同じ色にして、図のどこに出るかを思い浮かべられるようにする。
 * 空なら点線（帯は出ない）
 */
export const artifactField = (filled: boolean) =>
  `w-full rounded-sm border px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-500 dark:text-amber-50 dark:placeholder:text-zinc-400 ${
    filled
      ? "border-[#aaaa33] bg-[#fff5ad] dark:border-amber-300/60 dark:bg-amber-300/20"
      : "border-dashed border-[#aaaa33]/70 bg-[#fff5ad]/40 dark:border-amber-300/40 dark:bg-amber-300/5"
  }`;
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
  number,
  artifact,
  onFrom,
  onTo,
  onSwap,
}: {
  /** ライフラインの順（左から）に並べたもの */
  actors: Actor[];
  from: string;
  to: string;
  /** 図でのステップの番号（黒丸に出す）。まだ決まらない（分岐の中に足す）なら無し */
  number?: number;
  /** 渡すもの。あれば帯の矢印の下に、図と同じ黄色の帯で出す */
  artifact?: string;
  onFrom: (id: string) => void;
  onTo: (id: string) => void;
  /** 渡すと、送り手と受け手の入れ替えボタンを出す（手直しのパネルだけ） */
  onSwap?: () => void;
}) {
  const self = from === to;
  const picker = (side: "from" | "to") => (
    <label className={row}>
      <span className={`${rowLabel} leading-tight`}>
        {side === "from" ? "誰が" : "誰に"}
        <span className="block text-[10px] text-zinc-400">{side === "from" ? "送り手" : "受け手"}</span>
      </span>
      {/* 図の矢印と同じく、送り手の側に番号の黒丸、受け手の側に矢じり */}
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className="flex w-5 shrink-0 justify-center">
          {side === "from" ? <StepDot number={number} /> : <ArrowHead />}
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
      </span>
    </label>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {picker("from")}
          {picker("to")}
        </div>
        {onSwap && (
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
        )}
      </div>
      <LaneStrip actors={actors} from={from} to={to} number={number} artifact={artifact?.trim() || undefined} />
    </div>
  );
}

/**
 * 図での向きを示す、小さなレーンの帯。登場人物を図と同じ左右の順に並べ、送り手から受け手へ矢印を引く。
 * 送り手は塗り、受け手は枠で示す。自分の中の作業なら、その人に ↻ を付ける
 */
function LaneStrip({
  actors,
  from,
  to,
  number,
  artifact,
}: {
  actors: Actor[];
  from: string;
  to: string;
  number?: number;
  artifact?: string;
}) {
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
            {/* 番号の黒丸は送り手の側に、矢じりは受け手の側に（図と同じ） */}
            <span className={`absolute top-1/2 -translate-y-1/2 ${toRight ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}>
              <StepDot number={number} small />
            </span>
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
      {artifact && (
        // 図の付箋と同じく、送り手から受け手までの幅に（自分の作業なら、その人の右に）
        <div aria-hidden className="relative mt-1 h-4">
          <span
            className="absolute truncate rounded-sm border border-[#aaaa33] bg-[#fff5ad] px-1 text-center text-[10px] leading-[14px] text-zinc-900 dark:border-amber-300/60 dark:bg-amber-300/20 dark:text-amber-50"
            style={
              a === b
                ? { left: `${center(a)}%`, maxWidth: `${100 - center(a)}%` }
                : { left: `${left}%`, width: `${width}%`, minWidth: "3rem" }
            }
            title={artifact}
          >
            {artifact}
          </span>
        </div>
      )}
    </div>
  );
}

/** 図のステップの番号の黒丸（Mermaid の autonumber と同じ見た目）。番号が無ければ丸だけ */
function StepDot({ number, small = false }: { number?: number; small?: boolean }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-zinc-800 font-semibold text-white dark:bg-zinc-200 dark:text-zinc-900 ${
        small ? "h-3.5 min-w-3.5 px-0.5 text-[8px]" : "h-5 min-w-5 px-1 text-[10px]"
      }`}
    >
      {number}
    </span>
  );
}

/** 図の矢じり（受け手の側） */
function ArrowHead() {
  return <span className="h-0 w-0 border-y-[6px] border-l-[9px] border-y-transparent border-l-zinc-700 dark:border-l-zinc-300" />;
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

/**
 * 矢印の種類（終端の形）。図では依頼 = 塗りの三角、通知 = 開いた山形、返答 = 点線と塗りの三角で描く
 * （lib/render/mermaid.ts の arrowFor）。形の違いの意味が図だけでは分からないので、見本を添える。
 * 自分の中の作業（送り手と受け手が同じ）には出さない
 */
const ARROW_KINDS: { kind: Exclude<MessageKind, "self">; label: string; hint: string }[] = [
  { kind: "sync", label: "依頼", hint: "相手に頼んで、返事や結果を待つ" },
  { kind: "async", label: "通知", hint: "送るだけで、返事は待たない" },
  { kind: "reply", label: "返答", hint: "頼まれたことへの返事・結果を返す" },
];

function ArrowKindPicker({ kind, onChange }: { kind: MessageKind; onChange: (kind: MessageKind) => void }) {
  // 自分の作業だった手順を別の人へ付け替えたあとは "self" のまま。図では依頼の形で描かれる
  const current = kind === "self" ? "sync" : kind;
  return (
    <div className={row}>
      <span className={rowLabel}>矢印</span>
      <div className="flex flex-col gap-1">
        <div
          role="radiogroup"
          aria-label="矢印の種類"
          className="inline-flex w-fit rounded-md border border-black/15 p-0.5 dark:border-white/20"
        >
          {ARROW_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              role="radio"
              aria-checked={current === k.kind}
              title={k.hint}
              // 見本の矢印を文字の上に（パネルが狭く、横に並べると文字が折れる）
              className="flex flex-col items-center gap-0.5 whitespace-nowrap rounded px-2.5 py-1 text-xs text-zinc-600 aria-checked:bg-sky-600 aria-checked:text-white dark:text-zinc-300"
              onClick={() => current !== k.kind && onChange(k.kind)}
            >
              <ArrowGlyph kind={k.kind} />
              {k.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-zinc-500">{ARROW_KINDS.find((k) => k.kind === current)?.hint}</span>
      </div>
    </div>
  );
}

/** 矢印の見本（図の終端の形と揃える） */
function ArrowGlyph({ kind }: { kind: Exclude<MessageKind, "self"> }) {
  return (
    <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="5"
        x2={kind === "async" ? 25 : 21}
        y2="5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={kind === "reply" ? "3 2" : undefined}
      />
      {kind === "async" ? (
        <path d="M19 1 L26 5 L19 9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      ) : (
        <path d="M19 1 L27 5 L19 9 Z" fill="currentColor" />
      )}
    </svg>
  );
}
