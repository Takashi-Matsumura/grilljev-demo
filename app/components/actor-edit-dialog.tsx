"use client";

import { useRef, useState } from "react";
import type { Actor, FlowModel, ModelOp } from "@/lib/model/types";
import { StakeholderEditor, type StakeholderRow } from "./stakeholder-editor";

const toRows = (model: FlowModel): StakeholderRow[] =>
  [...model.actors]
    .sort((a, b) => a.lane - b.lane)
    .map((a) => ({ key: a.id, name: a.name, kind: a.kind, role: a.role, present: a.present }));

/**
 * 編集結果を ops にする。比べる相手は**保存する瞬間の最新モデル**（ダイアログを開いている間にも、
 * 会話の判定で図は育つ）。変わった項目だけを送り、開いている間に消えた（統合された）人は飛ばす。
 */
export function editOps(model: FlowModel, rows: StakeholderRow[]): ModelOp[] {
  const byId = new Map(model.actors.map((a) => [a.id, a]));
  const ops: ModelOp[] = [];

  for (const r of rows) {
    const a = byId.get(r.key);
    if (!a) continue;
    const patch: Extract<ModelOp, { op: "actor.update" }>["patch"] = {};
    const name = r.name.trim();
    if (name !== "" && name !== a.name) patch.name = name;
    if (r.kind !== a.kind) patch.kind = r.kind;
    if (r.role !== a.role) patch.role = r.role ?? null;
    if (r.present !== undefined && r.present !== a.present) patch.present = r.present;
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
    const actor: Omit<Actor, "lane" | "addedAtRev"> = { id, name: r.name.trim(), kind: r.kind, aliases: [] };
    if (r.role) actor.role = r.role;
    if (r.present !== undefined) actor.present = r.present;
    ops.push({ op: "actor.add", actor });
  }

  const newIds = new Set(idOf.values());
  const ids = rows.map((r) => idOf.get(r.key) ?? r.key).filter((id) => byId.has(id) || newIds.has(id));
  const current = [...model.actors].sort((a, b) => a.lane - b.lane).map((a) => a.id);
  const changed = newIds.size > 0 || ids.some((id, i) => current[i] !== id);
  if (changed) ops.push({ op: "actor.reorder", ids });
  return ops;
}

/** 会議画面で登場人物を手直しする。会話の途中で出てきた人に、起点・終点・出席を付けられる。 */
export function ActorEditDialog({ model, onSave }: { model: FlowModel; onSave: (ops: ModelOp[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<StakeholderRow[]>([]);
  const [originalIds, setOriginalIds] = useState<Set<string>>(new Set());

  const open = () => {
    setRows(toRows(model));
    setOriginalIds(new Set(model.actors.map((a) => a.id)));
    ref.current?.showModal();
  };
  const empty = model.actors.length === 0;
  const names = rows.map((r) => r.name.trim()).filter((n) => n !== "");
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  const save = () => {
    const ops = editOps(model, rows);
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
            : "登場人物を追加したり、名前・種別・起点/終点・出席・並び順を直したりします"
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
          <StakeholderEditor rows={rows} onChange={setRows} canRemove={(r) => !originalIds.has(r.key)} />
          <p className="text-xs text-zinc-500">
            図にすでにいる人は削除できません（ステップがつながっているため）。改名すると、元の名前は別名として残ります。
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
