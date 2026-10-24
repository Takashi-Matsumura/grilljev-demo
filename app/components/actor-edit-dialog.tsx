"use client";

import { useRef, useState } from "react";
import { rebaseNoteOps } from "@/lib/model/notes";
import { applyOps } from "@/lib/model/reducer";
import type { Actor, FlowModel, ModelOp } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";
import { NotesSection } from "./notes-section";
import { StakeholderEditor, type StakeholderRow } from "./stakeholder-editor";

const toRows = (model: FlowModel): StakeholderRow[] =>
  [...model.actors]
    .sort((a, b) => a.lane - b.lane)
    .map((a) => ({
      key: a.id,
      name: a.name,
      kind: a.kind,
      role: a.role,
      focus: a.focus,
      present: a.present,
      members: a.members,
      aliases: a.aliases,
      product: a.product,
      note: a.note,
    }));

const sameList = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x, i) => x === b[i]);
/** 1 行の文字欄。空白をならし、空なら undefined */
const text = (v: string | undefined) => v?.replace(/\s+/g, " ").trim() || undefined;

/** 「部署に入れる」で、個人の列を部署にたたむ予約。保存するまで図は変えない */
export type Fold = { from: string; into: string };

/**
 * 編集結果を ops にする。比べる相手は**保存する瞬間の最新モデル**（ダイアログを開いている間にも、
 * 会話の判定で図は育つ）。変わった項目だけを送り、開いている間に消えた（統合された）人は飛ばす。
 */
export function editOps(model: FlowModel, rows: StakeholderRow[], folds: Fold[] = []): ModelOp[] {
  const byId = new Map(model.actors.map((a) => [a.id, a]));
  const ops: ModelOp[] = [];

  // たたむのを先に。たたみ先のメンバーには、下の actor.update で（たたんだ人も含めた）全員を書く
  for (const f of folds) {
    if (byId.has(f.from) && byId.has(f.into)) ops.push({ op: "actor.fold", from: f.from, into: f.into });
  }
  // ダイアログで消した人（たたんだ人を除く）。ステップがつながっていれば reducer が無視する
  const kept = new Set(rows.map((r) => r.key));
  const folded = new Set(folds.map((f) => f.from));
  for (const a of model.actors) {
    if (!kept.has(a.id) && !folded.has(a.id)) ops.push({ op: "actor.remove", id: a.id });
  }

  for (const r of rows) {
    const a = byId.get(r.key);
    if (!a) continue;
    const patch: Extract<ModelOp, { op: "actor.update" }>["patch"] = {};
    const name = r.name.trim();
    if (name !== "" && name !== a.name) patch.name = name;
    if (r.kind !== a.kind) patch.kind = r.kind;
    if (r.role !== a.role) patch.role = r.role ?? null;
    if (r.focus !== a.focus) patch.focus = r.focus ?? null;
    if (r.present !== a.present) patch.present = r.present ?? null;
    if (!sameList(r.members, a.members)) patch.members = r.members ?? [];
    if (!sameList(r.aliases, a.aliases)) patch.aliases = r.aliases ?? [];
    if (text(r.product) !== a.product) patch.product = text(r.product) ?? null;
    if (text(r.note) !== a.note) patch.note = text(r.note) ?? null;
    if (Object.keys(patch).length > 0) ops.push({ op: "actor.update", id: a.id, patch });
  }

  // ダイアログで足した人。id は既存の最大値の続きから振る（reducer は lane と rev だけを決める）
  const used = model.actors.map((a) => Number(a.id.replace(/^A/, ""))).filter(Number.isFinite);
  let seq = used.length > 0 ? Math.max(...used) : 0;
  const idOf = new Map<string, string>();
  for (const r of rows) {
    if (byId.has(r.key) || r.name.trim() === "") continue;
    seq += 1;
    const id = `A${seq}`;
    idOf.set(r.key, id);
    const actor: Omit<Actor, "lane" | "addedAtRev"> = { id, name: r.name.trim(), kind: r.kind, aliases: r.aliases ?? [] };
    if (r.role) actor.role = r.role;
    if (r.focus) actor.focus = true;
    if (r.present !== undefined) actor.present = r.present;
    if (r.members && r.members.length > 0) actor.members = r.members;
    if (text(r.product)) actor.product = text(r.product);
    if (text(r.note)) actor.note = text(r.note);
    ops.push({ op: "actor.add", actor });
  }

  const newIds = new Set(idOf.values());
  const ids = rows.map((r) => idOf.get(r.key) ?? r.key).filter((id) => byId.has(id) || newIds.has(id));
  const current = [...model.actors]
    .sort((a, b) => a.lane - b.lane)
    .map((a) => a.id)
    .filter((id) => kept.has(id));
  const changed = newIds.size > 0 || ids.some((id, i) => current[i] !== id);
  if (changed) ops.push({ op: "actor.reorder", ids });
  return ops;
}

/**
 * 削除できない理由。図に残っているステップがつながっている人は消せない。
 * 図の番号で示し、代わりの手（部署に入れる・先にステップを消す）を添える。
 */
export function removeBlockedReason(model: FlowModel, row: StakeholderRow): string | null {
  const shown = visibleSteps(model);
  const numbers = model.steps
    .filter((s) => (s.from === row.key || s.to === row.key) && s.status !== "retracted")
    .map((s) => shown.indexOf(s) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (numbers.length === 0) return null;
  const alt =
    row.kind === "person" ? "部署に入れるか、先にステップを消してください" : "先にステップを消すか、送り手・受け手を付け替えてください";
  return `${numbers.map((n) => `${n}番`).join("・")}のステップがつながっているため、削除できません。${alt}。`;
}

/** 削除すると一緒に消える、取り消し済みのステップの知らせ（無ければ null） */
export function removeNotice(model: FlowModel, row: StakeholderRow): string | null {
  const retracted = model.steps.filter((s) => (s.from === row.key || s.to === row.key) && s.status === "retracted");
  if (retracted.length === 0) return null;
  const names = retracted.map((s) => `「${s.label}」`).join("");
  return `削除すると、削除したステップ${names}も一緒に完全に消えます（元に戻せなくなります）。`;
}

/** 会議画面で登場人物を手直しする。会話の途中で出てきた人に、起点・終点・出席を付けられる。 */
export function ActorEditDialog({ model, onSave }: { model: FlowModel; onSave: (ops: ModelOp[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<StakeholderRow[]>([]);
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());
  const [folds, setFolds] = useState<Fold[]>([]);
  // 登場人物の付箋の書きため。ほかの変更と同じく、保存するまで図には当てない（やめれば捨てる）
  const [noteOps, setNoteOps] = useState<ModelOp[]>([]);
  const noted = noteOps.length > 0 ? applyOps(model, noteOps, model.updatedAt) : model;

  const open = () => {
    setRows(toRows(model));
    setOriginalIds(new Set(model.actors.map((a) => a.id)));
    setFolds([]);
    setNoteOps([]);
    ref.current?.showModal();
  };
  const empty = model.actors.length === 0;
  const names = rows.map((r) => r.name.trim()).filter((n) => n !== "");
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  const save = () => {
    const ops = [...editOps(model, rows, folds), ...rebaseNoteOps(model, noteOps)];
    if (ops.length > 0) onSave(ops);
    ref.current?.close();
  };

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <>
      {/* 会議中に新しい関係者が分かったときにも押すので、目立つ Aqua のボタンにする。
          登場人物が 0 人なら、まずここから始めてほしいので、青く脈動させて光の輪で誘う */}
      <button
        type="button"
        className={`aqua-button flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 text-[10px] leading-tight font-medium ${
          empty ? "aqua-button--beckon" : "aqua-button--clear"
        }`}
        onClick={open}
        title={
          empty
            ? "業務に関わる人・部署・システムを、会話の前に登録します"
            : "登場人物を追加したり、名前・種別・製品名・呼び方・起点/終点・出席・並び順を直したりします"
        }
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" />
          <path d="M19 8v6M16 11h6" />
        </svg>
        <span>
          登場人物
          <br />
          {empty ? "を登録" : "を編集"}
        </span>
      </button>
      <dialog
        ref={ref}
        aria-label="登場人物の編集"
        className="m-auto w-[min(48rem,92vw)] rounded-lg border border-black/15 bg-white p-4 text-inherit backdrop:bg-black/40 dark:border-white/20 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-3">
          <StakeholderEditor
            rows={rows}
            onChange={setRows}
            removeBlocked={(r) => (originalIds.has(r.key) ? removeBlockedReason(model, r) : null)}
            removeNotice={(r) => (originalIds.has(r.key) ? removeNotice(model, r) : null)}
            // 付箋は図にいる人だけ（ダイアログで足したばかりの人には、まだ id が無い）
            extra={(r) =>
              originalIds.has(r.key) ? (
                <NotesSection
                  model={noted}
                  target={{ kind: "actor", id: r.key }}
                  onCommit={(ops) => setNoteOps([...noteOps, ...ops])}
                  inline
                />
              ) : null
            }
            // 図にいる個人だけ（ダイアログで足したばかりの人は、たたむステップが無いので消せばよい）
            onFold={(fromKey, intoKey) => {
              const from = rows.find((r) => r.key === fromKey);
              if (!from || !originalIds.has(fromKey) || !originalIds.has(intoKey)) return;
              setFolds([...folds, { from: fromKey, into: intoKey }]);
              setRows(
                rows
                  .filter((r) => r.key !== fromKey)
                  .map((r) =>
                    r.key === intoKey ? { ...r, members: [...new Set([...(r.members ?? []), from.name])] } : r,
                  ),
              );
            }}
          />
          {folds.length > 0 && (
            <p className="text-xs text-sky-700 dark:text-sky-300">
              保存すると、
              {folds
                .map((f) => {
                  const a = model.actors.find((x) => x.id === f.from)?.name;
                  const b = model.actors.find((x) => x.id === f.into)?.name;
                  return `「${a}」を${b}のメンバーに`;
                })
                .join("、")}
              します（その人のステップは部署から出て、担当者がその人になります）。
            </p>
          )}
          <p className="text-xs text-zinc-500">
            図にあるステップがつながっている人は削除できません。改名すると、元の名前は別名として残ります。
          </p>
          {duplicate && (
            <p role="alert" className="text-xs text-amber-600 dark:text-amber-400">
              「{duplicate}」が重複しています。名前は 1 人ずつ違うものにしてください。
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => ref.current?.close()}>
              やめる
            </button>
            <button type="button" className={btn} disabled={duplicate !== undefined} onClick={save}>
              保存
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
