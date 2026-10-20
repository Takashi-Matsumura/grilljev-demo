"use client";

import { useRef, useState } from "react";
import type { ActorKind, ActorRole } from "@/lib/model/types";
import { MAX_ACTOR_CHARS, MAX_SEED_ACTORS, splitNames, type SeedActor } from "@/lib/store/session-types";

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
};

const KIND_OPTIONS: { value: ActorKind; label: string }[] = [
  { value: "role", label: "部署・役職" },
  { value: "person", label: "個人" },
  { value: "system", label: "システム" },
  { value: "external", label: "社外" },
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
  }));

/** 出席が未設定の行は、チェックボックスを「どちらでもない」表示にする */
function PresentCheckbox({ value, onChange }: { value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={value === true}
      ref={(el) => {
        if (el) el.indeterminate = value === undefined;
      }}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

/**
 * 会議の前に、業務の登場人物（シーケンス図のライフライン）を並べる。会議画面での手直しにも使う。
 * 自分の作業の前後にいる人を先に置いておくと、会話が「その間をどうつなぐか」に向かう。
 */
export function StakeholderEditor({
  rows,
  onChange,
  canRemove = () => true,
}: {
  rows: StakeholderRow[];
  onChange: (rows: StakeholderRow[]) => void;
  /** 削除できる行か。会議画面では、図にすでにいる人は消さない（ステップが宙に浮くため） */
  canRemove?: (row: StakeholderRow) => boolean;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /** 名前をチップ（登場人物）にする。既出の名前は足さない。上限を超えた分も足さない（既存は削らない） */
  const add = (text: string) => {
    const known = new Set(rows.map((r) => r.name));
    const added = splitNames(text)
      .map((n) => n.slice(0, MAX_ACTOR_CHARS))
      .filter((n) => !known.has(n) && (known.add(n), true))
      .map((name) => newStakeholderRow(name));
    if (added.length > 0) onChange([...rows, ...added.slice(0, Math.max(0, MAX_SEED_ACTORS - rows.length))]);
  };
  /**
   * 入力中の文字に区切り（「、」「,」改行）が入ったら、そこまでをチップにする。貼り付けも同じ。
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
  const remove = (key: string) => onChange(rows.filter((x) => x.key !== key));
  const update = (key: string, patch: Partial<StakeholderRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // 起点・終点はそれぞれ 1 人だけ。押し直すと外れる
  const toggleRole = (key: string, role: ActorRole) =>
    onChange(
      rows.map((r) => {
        if (r.key === key) return { ...r, role: r.role === role ? undefined : role };
        return r.role === role ? { ...r, role: undefined } : r;
      }),
    );
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const input =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
  const small =
    "rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-30 dark:border-white/20 dark:hover:bg-white/10";
  const roleOn = "border-sky-600 bg-sky-100 text-sky-800 dark:border-sky-400 dark:bg-sky-500/20 dark:text-sky-300";
  const hasTrigger = rows.some((r) => r.role === "trigger");
  const hasEnd = rows.some((r) => r.role === "end");

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div>
        <span>登場人物</span>
        {/* auto-phrase: 日本語を文節の切れ目で折り返す（「入れま／す」のような折り返しを避ける） */}
        <p className="text-xs text-zinc-500 [word-break:auto-phrase]">
          この業務に関わる人・部署・システムを、業務が流れる順に並べてください。会議に出ていない人も入れます。
          左から順に図のライフラインになります。
        </p>
      </div>

      {/* 名前を打って Enter（または「、」）でチップにする。チップがそのまま登場人物になる */}
      <div
        className="flex min-h-10 cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-black/15 px-2 py-1.5 focus-within:border-sky-600 focus-within:ring-2 focus-within:ring-sky-600/20 dark:border-white/20 dark:focus-within:border-sky-400"
        onClick={() => inputRef.current?.focus()}
      >
        {rows.map((r) => (
          <span
            key={r.key}
            className="flex max-w-full items-center gap-1 rounded-md border border-black/10 bg-zinc-50 py-0.5 pr-1 pl-2 text-sm dark:border-white/15 dark:bg-white/10"
            title={canRemove(r) ? undefined : "図にすでにいるため、削除できません"}
          >
            <span className="truncate">{r.name || "（未入力）"}</span>
            {canRemove(r) ? (
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-500 hover:bg-black/10 hover:text-zinc-800 dark:hover:bg-white/15 dark:hover:text-zinc-100"
                aria-label={`${r.name || "この人"}を削除`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(r.key);
                }}
              >
                ×
              </button>
            ) : (
              <span className="w-1" />
            )}
          </span>
        ))}
        {rows.length < MAX_SEED_ACTORS ? (
          <input
            ref={inputRef}
            className="min-w-[10rem] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-zinc-400"
            value={draft}
            aria-label="登場人物の名前"
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
              } else if (e.key === "Backspace" && draft === "") {
                const last = rows[rows.length - 1];
                if (last && canRemove(last)) remove(last.key);
              }
            }}
            placeholder={rows.length === 0 ? "名前を入力して Enter（例: 顧客）" : "さらに追加…"}
          />
        ) : (
          <span className="px-1 text-xs text-zinc-500">上限（{MAX_SEED_ACTORS} 人）に達しました</span>
        )}
      </div>

      {rows.length > 0 && (
        <p className="text-xs text-zinc-500">種別・起点/終点・出席・並び順は、ここで設定します。</p>
      )}
      {rows.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li
              key={r.key}
              className="flex flex-wrap items-center gap-1.5 rounded-md border border-black/10 p-1.5 dark:border-white/15"
            >
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-zinc-400">{i + 1}</span>
              <input
                className={`${input} min-w-0 flex-1 basis-32`}
                value={r.name}
                maxLength={MAX_ACTOR_CHARS}
                aria-label={`${i + 1} 人目の名前`}
                onChange={(e) => update(r.key, { name: e.target.value })}
              />
              <select
                className="rounded-md border border-black/15 bg-transparent px-1.5 py-1.5 text-xs dark:border-white/20"
                value={r.kind}
                aria-label="種別"
                onChange={(e) => update(r.key, { kind: e.target.value as ActorKind })}
              >
                {r.kind === "unknown" && <option value="unknown">不明</option>}
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {/* 起点・終点・出席はひとまとまり。狭い幅でも、この途中では折り返さない */}
              <span className="flex shrink-0 items-center gap-1.5">
                {(["trigger", "end"] as const).map((role) => (
                  <button
                    key={role}
                    type="button"
                    aria-pressed={r.role === role}
                    title={ROLE_TEXT[role].hint}
                    className={`${small} ${r.role === role ? roleOn : ""}`}
                    onClick={() => toggleRole(r.key, role)}
                  >
                    {ROLE_TEXT[role].label}
                  </button>
                ))}
                <label
                  className="flex items-center gap-1 px-1 text-xs"
                  title={r.present === undefined ? "出席はまだ未設定です" : "この会議に出席しているか"}
                >
                  <PresentCheckbox value={r.present} onChange={(present) => update(r.key, { present })} />
                  出席
                </label>
              </span>
              <span className="flex gap-1">
                <button type="button" className={small} aria-label="左へ" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className={small}
                  aria-label="右へ"
                  disabled={i === rows.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      {rows.length > 0 && (!hasTrigger || !hasEnd) && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {!hasTrigger && "誰がこの業務を始めるか（起点）"}
          {!hasTrigger && !hasEnd && "と、"}
          {!hasEnd && "最終的な成果を誰が受け取るか（終点）"}
          を選んでおくと、会話の行き先がはっきりします。
        </p>
      )}

      {rows.length > 0 && <LanePreview rows={rows} />}
    </div>
  );
}

/** 図の頭（ライフラインの並び）だけを先に見せる。出席していない人は薄く出す。 */
function LanePreview({ rows }: { rows: StakeholderRow[] }) {
  return (
    <div aria-label="図のライフラインの並び" className="overflow-x-auto rounded-md bg-zinc-50 p-3 dark:bg-white/5">
      <div className="flex w-max gap-3">
        {rows.map((r) => (
          <div key={r.key} className={`flex w-24 flex-col items-center ${r.present === false ? "opacity-50" : ""}`}>
            <span className="w-full truncate rounded border border-black/20 bg-background px-1.5 py-1 text-center text-xs dark:border-white/25">
              {r.name || "（未入力）"}
            </span>
            <span className="h-6 border-l border-dashed border-black/30 dark:border-white/30" />
            <span className="h-4 text-[11px] leading-4 text-zinc-500">
              {[r.role && ROLE_TEXT[r.role].label, r.present === false && "出席なし"].filter(Boolean).join("・")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
