"use client";

import type { ShiftProposal, ShiftStatus } from "./use-scope-shift";

const HEADLINE: Record<ShiftProposal["relation"], string> = {
  sibling: "別の業務の話に移ったようです",
  parent: "もっと大きな業務の枠組みの話に広がったようです",
  child: "1 つのステップの細かい話に入ったようです",
};

type Props = {
  proposal: ShiftProposal | null;
  status: ShiftStatus;
  onSplit: () => void;
  onRename: () => void;
  onDismiss: () => void;
  devMode?: boolean;
};

/** 対象業務（共通認識）の変更案。**自動では変えず**、選んだ操作だけが反映される。 */
export function ScopeBanner({ proposal, status, onSplit, onRename, onDismiss, devMode = false }: Props) {
  if (!proposal) {
    // 確認中は開発者モードでだけ見せる（進捗のつぶやきで、本番では場所を取るだけ）。
    // 失敗は常に見せる。何も無ければ場所を取らない
    if (status.kind === "idle") return null;
    if (status.kind === "checking" && !devMode) return null;
    return (
      <div
        role={status.kind === "error" ? "alert" : "status"}
        className={`border-b border-black/10 px-4 py-1.5 text-xs dark:border-white/15 ${
          status.kind === "error" ? "text-red-600 dark:text-red-400" : "text-zinc-500"
        }`}
      >
        対象業務の変化: {status.message}
      </div>
    );
  }

  const btn =
    "rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10";
  const primary =
    "rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90";

  return (
    <section
      role="alert"
      aria-label="対象業務の変更の確認"
      className="border-b border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="font-medium">
            ⚠ {HEADLINE[proposal.relation]}
            {devMode && proposal.moved !== null && (
              <span className="ml-2 text-xs font-normal tabular-nums text-zinc-500">
                （範囲外 {proposal.moved.toFixed(2)}）
              </span>
            )}
          </p>
          <p className="mt-1 break-words text-sm">
            「{proposal.currentTitle || "（未設定）"}」 →{" "}
            <span className="font-medium">「{proposal.title}」</span>
            {proposal.reason && <span className="text-zinc-500">　{proposal.reason}</span>}
          </p>
          {proposal.evidence && (
            <p className="mt-1 break-words text-xs text-zinc-500">根拠: 「{proposal.evidence}」</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {proposal.relation === "sibling" && (
            <>
              <button type="button" className={primary} onClick={onSplit}>
                図を分ける
              </button>
              <button type="button" className={btn} onClick={onDismiss}>
                同じ業務として続ける
              </button>
              <button type="button" className={btn} onClick={onRename}>
                対象を差し替える
              </button>
            </>
          )}
          {proposal.relation === "parent" && (
            <>
              <button type="button" className={primary} onClick={onRename}>
                対象業務を広げる
              </button>
              <button type="button" className={btn} onClick={onDismiss}>
                今の範囲のまま続ける
              </button>
            </>
          )}
          {proposal.relation === "child" && (
            <>
              {/* 入れ子の図（サブシーケンス）はまだ無いので、別の図として詳細化する */}
              <button type="button" className={primary} onClick={onSplit}>
                別の図として詳細化する
              </button>
              <button type="button" className={btn} onClick={onDismiss}>
                そのまま続ける
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
