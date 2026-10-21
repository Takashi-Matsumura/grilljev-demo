import Link from "next/link";
import { listDiagrams } from "@/lib/store/diagrams";
import { DiagramList } from "./diagram-list";

// 保存済みの一覧は毎回読む（ビルド時に固定しない）
export const dynamic = "force-dynamic";

export default async function EditorHome() {
  const diagrams = await listDiagrams();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-black/10 px-4 py-2 dark:border-white/15">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="text-lg font-semibold">業務フロー図エディタ</h1>
          <p className="hidden truncate text-sm text-zinc-500 sm:block">登場人物とステップを手で並べて、業務フロー図を描く</p>
        </div>
        <Link href="/" className="shrink-0 text-sm text-zinc-500 hover:underline">
          会議の一覧へ
        </Link>
      </header>
      <DiagramList initial={diagrams} />
    </div>
  );
}
