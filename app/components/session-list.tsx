"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SAMPLE_SCOPE } from "@/lib/sample/scenario";
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

  const input =
    "w-full rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/10";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-4">
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">新しい会議を始める</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void create(title, splitDepartments(departments));
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            業務名
            <input className={input} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="例: 月次請求書発行業務" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            関係部署（「、」または「,」区切り）
            <input className={input} value={departments} onChange={(e) => setDepartments(e.target.value)} placeholder="例: 営業、経理、部長" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={btn} disabled={busy || title.trim() === ""}>
              会議を始める
            </button>
            <button
              type="button"
              className={btn}
              disabled={busy}
              onClick={() => void create(SAMPLE_SCOPE.title, [...SAMPLE_SCOPE.departments])}
            >
              サンプルで始める
            </button>
          </div>
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
                <a href={`/s/${s.slug}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="block text-xs text-zinc-500">
                    {s.title} ／ 更新 {fmt(s.updatedAt)} ／ 発話 {s.lines}・ステップ {s.steps}
                  </span>
                </a>
                {confirming === s.slug ? (
                  <span className="flex shrink-0 gap-2">
                    <button className={btn} onClick={() => void remove(s.slug)}>
                      削除する
                    </button>
                    <button className={btn} onClick={() => setConfirming(null)}>
                      やめる
                    </button>
                  </span>
                ) : (
                  <button className={btn} onClick={() => setConfirming(s.slug)}>
                    削除
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
