import { HealthButton } from "@/app/components/health-dialog";
import { Studio } from "@/app/components/studio";
import { checkHealth } from "@/lib/health";

// バックエンドの状態は毎回実測する（ビルド時に固定しない）
export const dynamic = "force-dynamic";

export default async function Home() {
  const health = await checkHealth();

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-lg font-semibold">grilljev</h1>
          <p className="hidden truncate text-sm text-zinc-500 sm:block">
            会議の音声から、業務フロー（シーケンス図）をリアルタイムに立ち上げる
          </p>
        </div>
        <HealthButton initial={health} />
      </header>
      <Studio />
    </div>
  );
}
