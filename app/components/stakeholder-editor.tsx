"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ActorKind, ActorRole } from "@/lib/model/types";
import {
  MAX_ACTOR_CHARS,
  MAX_MEMBERS,
  MAX_SEED_ACTORS,
  splitNames,
  type SeedActor,
} from "@/lib/store/session-types";
import { ToggleSwitch } from "./toggle-switch";

/**
 * 編集中の 1 行。key は並べ替え・削除で React の行を取り違えないためのもの（会議画面ではアクターの id）。
 * 会話の中で出てきた人は、種別が "unknown"、出席が未設定（undefined）のことがある。
 */
export type StakeholderRow = {
  key: string;
  name: string;
  kind: ActorKind;
  role?: ActorRole;
  present?: boolean;
  /** 部署の中の人（担当者の候補）。個人は列にせず、ここに書く */
  members?: string[];
};

/** メンバーを書ける種別。個人・システムは、それ自体が 1 人（1 つ）なので持たない */
const hasMembers = (kind: ActorKind) => kind === "role" || kind === "external" || kind === "unknown";

const KIND_OPTIONS: { value: Exclude<ActorKind, "unknown">; label: string; short: string }[] = [
  { value: "role", label: "部署・役職", short: "部署" },
  { value: "person", label: "個人", short: "個人" },
  { value: "system", label: "システム", short: "システム" },
  { value: "external", label: "社外", short: "社外" },
];

const ROLE_TEXT: Record<ActorRole, { label: string; hint: string }> = {
  trigger: { label: "起点", hint: "この業務を始める人（最初の依頼・申込みをする人）" },
  end: { label: "終点", hint: "最終的な成果（書類・データ・結果）を受け取る人" },
};

/** チップを確定する区切り。Enter と Tab はキー操作で扱う */
const SEPARATOR = /[、,，\n]/;

let seq = 0;
const newKey = () => `r${++seq}`;

/** 新しく足す 1 行（手入力・候補の採用で共通） */
export const newStakeholderRow = (name: string, kind: ActorKind = "role"): StakeholderRow => ({
  key: newKey(),
  name,
  kind,
  present: true,
});

export const toSeedActors = (rows: StakeholderRow[]): SeedActor[] =>
  rows.map((r) => ({
    name: r.name,
    kind: r.kind === "unknown" ? "role" : r.kind,
    role: r.role,
    present: r.present ?? true,
    ...(r.members && r.members.length > 0 ? { members: r.members } : {}),
  }));

/** 「田中、佐藤」→ ["田中", "佐藤"]。空・重複・長すぎる名前は除く */
const parseMembers = (text: string): string[] =>
  [...new Set(splitNames(text).map((n) => n.replace(/(さん|様|氏)$/, "").slice(0, MAX_ACTOR_CHARS)))]
    .filter((n) => n !== "")
    .slice(0, MAX_MEMBERS);

/** 種別のアイコン（カードの名前の前に出す） */
function KindIcon({ kind }: { kind: ActorKind }) {
  const paths: Record<ActorKind, ReactNode> = {
    role: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6" />
      </>
    ),
    person: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    system: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
    external: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </>
    ),
    unknown: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 17h.01" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0 text-zinc-500"
    >
      {paths[kind]}
    </svg>
  );
}

/**
 * 会議の前に、業務の登場人物（シーケンス図のライフライン）を並べる。会議画面での手直しにも使う。
 * 自分の作業の前後にいる人を先に置いておくと、会話が「その間をどうつなぐか」に向かう。
 *
 * 図の頭と同じ形のカードを左から並べ、そのカードを直接いじる（見たままが図の並びになる）。
 * 名前・種別・出席・削除・並べ替えは、カードを押すと開くパネルで。起点・終点は全体で 1 人ずつなので下のセレクトで選ぶ。
 */
export function StakeholderEditor({
  rows,
  onChange,
  removeBlocked = () => null,
  removeNotice = () => null,
  onFold,
  footer,
}: {
  rows: StakeholderRow[];
  onChange: (rows: StakeholderRow[]) => void;
  /**
   * 削除できない理由（削除できるなら null）。会議画面では、ステップがつながっている人は消さない
   * （送り手・受け手のいないステップは図に描かれず、黙って消えてしまうため）
   */
  removeBlocked?: (row: StakeholderRow) => string | null;
  /** 削除できるが、一緒に消えるものがあるときの知らせ（取り消したステップなど） */
  removeNotice?: (row: StakeholderRow) => string | null;
  /**
   * 個人の列を部署にたたむ（会議画面だけ）。渡すと、個人のカードに「部署に入れる」を出す。
   * その人のステップは部署から出るようになり、担当者がその人になる
   */
  onFold?: (fromKey: string, intoKey: string) => void;
  /** レーンの下端に置くもの（開始画面の AI 候補） */
  footer?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // メンバーの書きかけ（「、」で区切った 1 行）。カードを切り替えたら、そのカードの今のメンバーから書き直す
  const [membersDraft, setMembersDraft] = useState<{ key: string; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** 名前を登場人物にする。既出の名前は足さない。上限を超えた分も足さない（既存は削らない） */
  const add = (text: string) => {
    const known = new Set(rows.map((r) => r.name));
    const added = splitNames(text)
      .map((n) => n.slice(0, MAX_ACTOR_CHARS))
      .filter((n) => !known.has(n) && (known.add(n), true))
      .map((name) => newStakeholderRow(name));
    if (added.length > 0) onChange([...rows, ...added.slice(0, Math.max(0, MAX_SEED_ACTORS - rows.length))]);
  };
  /**
   * 入力中の文字に区切り（「、」「,」改行）が入ったら、そこまでを登場人物にする。貼り付けも同じ。
   * 区切りの後ろ（打ちかけの名前）は入力欄に残す。日本語の変換中は触らない（変換が壊れる）。
   */
  const takeText = (value: string) => {
    const parts = value.split(SEPARATOR);
    const rest = parts.pop() ?? "";
    if (parts.length > 0) add(parts.join("、"));
    setDraft(rest);
  };
  const commitDraft = () => {
    add(draft);
    setDraft("");
  };
  const remove = (key: string) => {
    onChange(rows.filter((x) => x.key !== key));
    setSelected(null);
  };
  const update = (key: string, patch: Partial<StakeholderRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // 起点・終点はそれぞれ 1 人だけ。key が null なら外す
  const setRole = (role: ActorRole, key: string | null) =>
    onChange(
      rows.map((r) => {
        if (r.key === key) return { ...r, role };
        return r.role === role ? { ...r, role: undefined } : r;
      }),
    );
  /** from 番目の人を to 番目へ動かす（ドラッグと ←→ で共通） */
  const moveTo = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= rows.length || to >= rows.length) return;
    const next = [...rows];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };

  const current = rows.find((r) => r.key === selected);
  const blocked = current ? removeBlocked(current) : null;
  const notice = current ? removeNotice(current) : null;
  const membersText =
    current && membersDraft?.key === current.key ? membersDraft.text : (current?.members ?? []).join("、");
  const commitMembers = () => {
    if (!current || membersDraft?.key !== current.key) return;
    update(current.key, { members: parseMembers(membersDraft.text) });
    setMembersDraft(null);
  };
  // たたみ先の候補: 部署・社外（メンバーを持てる人）
  const foldTargets = current ? rows.filter((r) => r.key !== current.key && (r.kind === "role" || r.kind === "external")) : [];
  const currentIndex = current ? rows.indexOf(current) : -1;
  const trigger = rows.find((r) => r.role === "trigger");
  const end = rows.find((r) => r.role === "end");

  const select =
    "rounded-md border border-black/15 bg-transparent px-2 py-1.5 text-sm dark:border-white/20 dark:bg-zinc-900";
  const small =
    "rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 disabled:opacity-30 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div>
        <span>登場人物</span>
        {/* auto-phrase: 日本語を文節の切れ目で折り返す（「入れま／す」のような折り返しを避ける） */}
        <p className="text-xs text-zinc-500 [word-break:auto-phrase]">
          業務が流れる順に、左から並べてください。会議に出ていない人も入れます。カードを押すと詳しく設定でき、ドラッグで並べ替えられます。
        </p>
      </div>

      <div className="flex flex-col rounded-lg border border-black/10 bg-zinc-50 dark:border-white/15 dark:bg-white/5">
        {/* 図の頭と同じ並び。横にあふれたらスクロール */}
        <ol aria-label="登場人物（左から図のライフラインの順）" className="flex gap-3 overflow-x-auto p-3">
          {rows.map((r, i) => {
            const isSelected = r.key === selected;
            const absent = r.present === false;
            // 2 行目: 出席の状態（欠席・未設定）を優先し、なければ種別。起点・終点はその前にバッジで出す
            const sub =
              r.present === undefined
                ? "出席は未設定"
                : absent
                  ? "欠席"
                  : r.role
                    ? ""
                    : (KIND_OPTIONS.find((o) => o.value === r.kind)?.label ?? "種別は未設定");
            return (
              <li
                key={r.key}
                className={`flex w-28 shrink-0 flex-col items-center ${dragging === r.key ? "opacity-40" : ""}`}
                draggable
                onDragStart={(e) => {
                  setDragging(r.key);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", r.key);
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  if (!dragging) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging) moveTo(rows.findIndex((x) => x.key === dragging), i);
                  setDragging(null);
                }}
              >
                <button
                  type="button"
                  aria-expanded={isSelected}
                  aria-label={`${i + 1} 人目: ${r.name || "（未入力）"}（${[r.role && ROLE_TEXT[r.role].label, sub].filter(Boolean).join("・")}）`}
                  onClick={() => setSelected(isSelected ? null : r.key)}
                  className={`flex h-14 w-full cursor-grab flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 active:cursor-grabbing ${
                    isSelected
                      ? "border-sky-600 bg-background ring-2 ring-sky-600/20 dark:border-sky-400"
                      : absent
                        ? "border-dashed border-black/25 bg-zinc-100 text-zinc-500 dark:border-white/25 dark:bg-white/5"
                        : "border-black/15 bg-background hover:border-black/30 dark:border-white/20 dark:hover:border-white/40"
                  }`}
                >
                  <span className="flex max-w-full items-center gap-1.5 font-medium">
                    <KindIcon kind={r.kind} />
                    <span className="truncate">{r.name || "（未入力）"}</span>
                  </span>
                  <span className="flex items-center gap-1 text-[11px] leading-4 text-zinc-500">
                    {r.role && (
                      <span className="rounded bg-sky-100 px-1.5 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300">
                        {ROLE_TEXT[r.role].label}
                      </span>
                    )}
                    {sub}
                  </span>
                </button>
                <span
                  aria-hidden
                  className={`h-6 border-l border-dashed ${absent ? "border-black/15 dark:border-white/15" : "border-black/30 dark:border-white/30"}`}
                />
              </li>
            );
          })}
          <li className="flex w-28 shrink-0 flex-col items-center">
            {rows.length < MAX_SEED_ACTORS ? (
              <label className="flex h-14 w-full cursor-text items-center gap-1 rounded-lg border border-dashed border-black/25 px-2 text-zinc-500 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-600/20 dark:border-white/25 dark:focus-within:border-sky-400">
                <span aria-hidden>＋</span>
                <input
                  ref={inputRef}
                  className="min-w-0 flex-1 bg-transparent py-0.5 text-sm text-inherit outline-none placeholder:text-zinc-500"
                  value={draft}
                  aria-label="登場人物を追加（「、」区切りでまとめて追加できます）"
                  onChange={(e) => {
                    if ((e.nativeEvent as InputEvent).isComposing) setDraft(e.target.value);
                    else takeText(e.target.value);
                  }}
                  onCompositionEnd={(e) => takeText(e.currentTarget.value)}
                  onBlur={commitDraft}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    // Enter でフォーム全体（会議の開始）が送信されないようにする
                    if (e.key === "Enter" || (e.key === "Tab" && draft.trim() !== "")) {
                      e.preventDefault();
                      commitDraft();
                    }
                  }}
                  placeholder={rows.length === 0 ? "例: 顧客" : "追加"}
                />
              </label>
            ) : (
              <span className="flex h-14 items-center px-1 text-xs text-zinc-500">上限（{MAX_SEED_ACTORS} 人）</span>
            )}
          </li>
        </ol>

        {current && (
          <div
            role="group"
            aria-label={`${current.name || "この人"}の設定`}
            className="mx-3 mb-3 flex flex-col gap-3 rounded-lg border border-black/15 bg-background p-3 shadow-sm dark:border-white/20"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setSelected(null);
              }
            }}
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
                名前
                <input
                  className="rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm text-foreground dark:border-white/20"
                  value={current.name}
                  maxLength={MAX_ACTOR_CHARS}
                  onChange={(e) => update(current.key, { name: e.target.value })}
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500" id={`kind-${current.key}`}>
                  種別{current.kind === "unknown" && "（未設定）"}
                </span>
                <div
                  role="group"
                  aria-labelledby={`kind-${current.key}`}
                  className="flex overflow-hidden rounded-md border border-black/15 dark:border-white/20"
                >
                  {KIND_OPTIONS.map((o, j) => (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={current.kind === o.value}
                      title={o.label}
                      onClick={() => update(current.key, { kind: o.value })}
                      className={`px-2.5 py-1.5 text-xs ${j > 0 ? "border-l border-black/15 dark:border-white/20" : ""} ${
                        current.kind === o.value
                          ? "bg-sky-600 text-white dark:bg-sky-500"
                          : "hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      {o.short}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {hasMembers(current.kind) && (
              <label className="flex flex-col gap-1 text-xs text-zinc-500">
                メンバー（担当者の候補。「、」区切り）
                <input
                  className="rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm text-foreground dark:border-white/20"
                  value={membersText}
                  placeholder="例: 田中、佐藤"
                  onChange={(e) => setMembersDraft({ key: current.key, text: e.target.value })}
                  onBlur={commitMembers}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    // Enter でフォーム全体（会議の開始）が送信されないようにする
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitMembers();
                    }
                  }}
                />
              </label>
            )}
            {onFold && current.kind === "person" && foldTargets.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-xs dark:bg-sky-500/10">
                <span className="text-zinc-600 dark:text-zinc-300">
                  個人は列にせず、部署のメンバーにするのがおすすめです
                </span>
                <select
                  className={select}
                  value=""
                  aria-label={`${current.name}を入れる部署`}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    onFold(current.key, e.target.value);
                    setSelected(null);
                  }}
                >
                  <option value="">部署に入れる…</option>
                  {foldTargets.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3 dark:border-white/10">
              <ToggleSwitch
                checked={current.present === true}
                onChange={(present) => update(current.key, { present })}
                label={current.present === undefined ? "会議に出席（未設定）" : "会議に出席"}
                title="この会議に出席しているか"
                onColorClass="bg-sky-600"
              />
              <span className="flex-1" />
              <button
                type="button"
                className={small}
                aria-label="左へ移動"
                disabled={currentIndex === 0}
                onClick={() => moveTo(currentIndex, currentIndex - 1)}
              >
                ←
              </button>
              <button
                type="button"
                className={small}
                aria-label="右へ移動"
                disabled={currentIndex === rows.length - 1}
                onClick={() => moveTo(currentIndex, currentIndex + 1)}
              >
                →
              </button>
              <button
                type="button"
                className="rounded-md px-2.5 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent dark:text-red-400 dark:hover:bg-red-500/10"
                disabled={blocked !== null}
                onClick={() => remove(current.key)}
              >
                削除
              </button>
              <button type="button" className={small} onClick={() => setSelected(null)}>
                閉じる
              </button>
            </div>
            {blocked && <p className="-mt-1 text-xs text-zinc-500">{blocked}</p>}
            {!blocked && notice && <p className="-mt-1 text-xs text-amber-700 dark:text-amber-400">{notice}</p>}
          </div>
        )}

        {footer && <div className="border-t border-black/10 px-3 py-2.5 dark:border-white/15">{footer}</div>}
      </div>

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {(["trigger", "end"] as const).map((role) => {
            const value = (role === "trigger" ? trigger : end)?.key ?? "";
            return (
              <label key={role} className="flex items-center gap-2" title={ROLE_TEXT[role].hint}>
                {ROLE_TEXT[role].label}
                <select
                  className={`${select} ${value === "" ? "text-zinc-500" : ""}`}
                  value={value}
                  onChange={(e) => setRole(role, e.target.value || null)}
                >
                  <option value="">未設定</option>
                  {rows.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.name || "（未入力）"}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
          {(!trigger || !end) && (
            <span className="text-xs text-amber-700 dark:text-amber-400">
              {!trigger && "業務を始める人"}
              {!trigger && !end && "と"}
              {!end && "成果を受け取る人"}
              を選ぶと、会話の行き先がはっきりします
            </span>
          )}
        </div>
      )}
    </div>
  );
}
