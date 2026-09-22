"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { splitDepartments, type SessionMeta } from "@/lib/store/session-types";

const fmt = (iso: string) => new Date(iso).toLocaleString("ja-JP", { hour12: false });

/** 新規作成フォームと、保存済みセッションの一覧（削除は 2 段階）。 */
export function SessionList({ initial }: { initial: SessionMeta[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [title, setTitle] = useState("");
  const [departments, setDepartments] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);

  async function create(t: string, d: string[]) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: t, departments: d }),
      });
      const data = (await res.json().catch(() => ({}))) as { slug?: string; error?: string };
      if (!res.ok || !data.slug) throw new Error(data.error ?? "作成に失敗しました");
      router.push(`/s/${data.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
      setBusy(false);
    }
  }

  async function remove(slug: string) {
    setConfirming(null);
    const res = await fetch(`/api/sessions/${slug}`, { method: "DELETE" });
    if (res.ok || res.status === 404) setSessions((s) => s.filter((x) => x.slug !== slug));
    else setError("削除に失敗しました");
  }

  function startEdit(slug: string, name: string) {
    setConfirming(null);
    setError(null);
    setEditingSlug(slug);
    setEditName(name);
  }

  async function saveRename(slug: string) {
    setRenaming(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${slug}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      const data = (await res.json().catch(() => ({}))) as { name?: string; error?: string };
      if (!res.ok || !data.name) throw new Error(data.error ?? "名前の変更に失敗しました");
      const name = data.name;
      setSessions((prev) => prev.map((x) => (x.slug === slug ? { ...x, name } : x)));
      setEditingSlug(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "名前の変更に失敗しました");
    } finally {
      setRenaming(false);
    }
  }

  const input =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">新しい会議を始める</h2>
        <form
          className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-start"
          onSubmit={(e) => {
            e.preventDefault();
            void create(title, splitDepartments(departments));
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span>
                業務名
                <span className="text-red-600 dark:text-red-400" aria-hidden>
                  {" "}
                  *
                </span>
              </span>
              <input
                className={input}
                value={title}
                maxLength={60}
                required
                aria-required="true"
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 月次請求書発行業務"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              関係部署（「、」または「,」区切り・任意）
              <input
                className={input}
                value={departments}
                onChange={(e) => setDepartments(e.target.value)}
                placeholder="例: 営業、経理、部長"
              />
            </label>
            <p className="text-xs text-zinc-500">
              <span className="text-red-600 dark:text-red-400">*</span> は必須項目です
            </p>
          </div>

          {/* 一番押してほしい操作なので、正方形の大きなボタンにして目立たせる */}
          <button
            type="submit"
            disabled={busy || title.trim() === ""}
            className="group flex h-32 w-32 shrink-0 flex-col items-center justify-center gap-2 self-center rounded-2xl bg-foreground text-background shadow-sm transition-all duration-150 ease-out hover:-translate-y-0.5 hover:scale-[1.03] hover:shadow-lg active:translate-y-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none sm:self-start"
          >
            <svg
              viewBox="0 0 24 24"
              width="30"
              height="30"
              fill="currentColor"
              aria-hidden
              className="transition-transform duration-150 ease-out group-hover:translate-x-0.5"
            >
              <path d="M8 5v14l11-7z" />
            </svg>
            <span className="text-sm font-medium">会議を始める</span>
          </button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
            {error}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">保存済みの会議（{sessions.length}）</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-zinc-500">まだありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li key={s.slug} className="flex items-center gap-3 rounded-md border border-black/10 p-3 dark:border-white/15">
                {editingSlug === s.slug ? (
                  <div className="min-w-0 flex-1">
                    <input
                      autoFocus
                      className={input}
                      value={editName}
                      maxLength={60}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(s.slug);
                        if (e.key === "Escape") setEditingSlug(null);
                      }}
                    />
                    <span className="block text-xs text-zinc-500">
                      {s.title} ／ 更新 {fmt(s.updatedAt)} ／ 発話 {s.lines}・ステップ {s.steps}
                    </span>
                  </div>
                ) : (
                  <a href={`/s/${s.slug}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {s.title} ／ 更新 {fmt(s.updatedAt)} ／ 発話 {s.lines}・ステップ {s.steps}
                    </span>
                  </a>
                )}
                {editingSlug === s.slug ? (
                  <span className="flex shrink-0 gap-2">
                    <button
                      className={btn}
                      disabled={renaming || editName.trim() === ""}
                      onClick={() => void saveRename(s.slug)}
                    >
                      保存
                    </button>
                    <button className={btn} disabled={renaming} onClick={() => setEditingSlug(null)}>
                      やめる
                    </button>
                  </span>
                ) : confirming === s.slug ? (
                  <span className="flex shrink-0 gap-2">
                    <button className={btn} onClick={() => void remove(s.slug)}>
                      削除する
                    </button>
                    <button className={btn} onClick={() => setConfirming(null)}>
                      やめる
                    </button>
                  </span>
                ) : (
                  <span className="flex shrink-0 gap-2">
                    <button className={btn} onClick={() => startEdit(s.slug, s.name)}>
                      名前を変更
                    </button>
                    <button className={btn} onClick={() => setConfirming(s.slug)}>
                      削除
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
