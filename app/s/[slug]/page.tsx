import Link from "next/link";
import { notFound } from "next/navigation";
import { HealthButton } from "@/app/components/health-dialog";
import { Studio } from "@/app/components/studio";
import { checkHealth } from "@/lib/health";
import { normalizeLoadedLines } from "@/lib/store/session-types";
import { readSession } from "@/lib/store/sessions";

export const dynamic = "force-dynamic";

export default async function SessionPage(props: PageProps<"/s/[slug]">) {
  const { slug } = await props.params;
  const [session, health] = await Promise.all([readSession(slug), checkHealth()]);
  if (!session) notFound();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <div className="flex min-w-0 items-baseline gap-3">
          <Link
            href="/"
            aria-label="一覧に戻る"
            title="一覧に戻る"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/15 text-zinc-500 hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>
          <h1 className="truncate text-lg font-semibold">{session.name}</h1>
        </div>
        <HealthButton initial={health} />
      </header>
      <Studio
        session={{
          slug: session.slug,
          seed: session.seed,
          model: session.model,
          archives: session.archives,
          lines: normalizeLoadedLines(session.lines),
        }}
      />
    </div>
  );
}
