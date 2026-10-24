"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FlowModel, ModelOp, Scope } from "@/lib/model/types";
import { codeFix, fixKindOf, type Fix } from "@/lib/review/fix";
import { CATEGORY_LABEL, reviewRules, SEVERITY_LABEL, type Finding, type Severity } from "@/lib/review/rules";
import { reviewKey, type AiReviewState } from "./use-ai-review";
import { useReviewWidth } from "./use-review-width";

/** パネルの幅の下限。指摘の見出しが 1 行に収まるくらい */
const REVIEW_MIN_PX = 320;
/** 広げても、図にはこれだけ残す（30rem） */
const DIAGRAM_MIN_PX = 480;
/** 境界をキーボード（← →）で動かすときの 1 回の幅 */
const KEY_STEP_PX = 32;

const SEVERITY_CLASS: Record<Severity, string> = {
  high: "bg-red-600 text-white",
  medium: "bg-amber-500 text-white",
  low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

const PREMISE_FIELDS: { key: keyof Pick<Scope, "purpose" | "trigger" | "frequency">; label: string; placeholder: string }[] = [
  { key: "purpose", label: "目的", placeholder: "例: 届いた請求書を期日までに正しく支払う" },
  { key: "trigger", label: "きっかけ", placeholder: "例: 取引先から請求書が届く" },
  { key: "frequency", label: "頻度", placeholder: "例: 月末に 30 件ほど" },
];

/** AI に頼んだ直す案。for は頼んだときの図（reviewKey）。図が変わったら作り直してもらう */
type AiFix =
  | { status: "loading"; for: string }
  | { status: "done"; for: string; fix: Fix | null }
  | { status: "error"; for: string; message: string };

/**
 * 図の点検（/editor の右側のパネル）。チームで描いた図の、描いた本人たちが気づきにくい抜けを指摘する。
 * - 図の点検: コードで確実に言えるもの（lib/review/rules.ts）。開いたらすぐ出る
 * - AI の指摘: ローカル AI が図を読んで、抜けていそうな手順・例外・業務名との食い違いを挙げる（30〜60 秒）
 * 指摘の手順の番号を押すと、図のそのステップを強調する。業務の前提（目的・きっかけ・頻度）はここで書ける。
 *
 * 直せる指摘には「直す案」を添える（lib/review/fix.ts）。案は勝手には当てない:
 * 「図で見る」で画面の図だけに映し（onPreview）、「この案で直す」で 1 回で当てる（元に戻す 1 回で戻る）。
 */
export function ReviewPanel({
  model,
  name,
  ai,
  onRunAi,
  onCommit,
  onPreview,
  onFocusStep,
  focusStep,
  onClose,
}: {
  model: FlowModel;
  name: string;
  ai: AiReviewState;
  /** AI の点検を頼む。already は図の点検で指摘済みの見出し（AI に重ねさせない） */
  onRunAi: (already: string[]) => void;
  onCommit: (ops: ModelOp[]) => void;
  /** 直す案を、モデルを変えずに画面の図だけへ映す（null で外す） */
  onPreview: (ops: ModelOp[] | null) => void;
  /** 指摘の手順の番号（1 始まり）を押したら、図で強調する。0 で外す */
  onFocusStep: (n: number) => void;
  focusStep: number;
  onClose: () => void;
}) {
  const rules = useMemo(() => reviewRules(model), [model]);
  const key = reviewKey(model, name);
  const stale = ai.status !== "idle" && ai.for !== key;
  const runAi = () => onRunAi(rules.map((f) => f.title));

  // ── 直す案 ──
  const [aiFixes, setAiFixes] = useState<Record<string, AiFix>>({});
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const fixCtrls = useRef(new Set<AbortController>());
  const fixOf = (f: (typeof rules)[number]): Fix | null => {
    const kind = fixKindOf(f);
    if (kind === "code") return codeFix(model, f);
    const got = aiFixes[f.id];
    return kind === "ai" && got?.status === "done" && got.for === key ? got.fix : null;
  };
  const requestFix = (findingId: string) => {
    const ctrl = new AbortController();
    fixCtrls.current.add(ctrl);
    const forKey = key;
    const set = (v: AiFix) => setAiFixes((prev) => ({ ...prev, [findingId]: v }));
    set({ status: "loading", for: forKey });
    fetch("/api/review/fix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, title: name, findingId }),
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as { fix?: Fix | null; error?: string };
        set(
          res.ok && json.fix !== undefined
            ? { status: "done", for: forKey, fix: json.fix }
            : { status: "error", for: forKey, message: json.error ?? `HTTP ${res.status}` },
        );
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        set({ status: "error", for: forKey, message: e instanceof Error ? e.message : "通信に失敗しました" });
      })
      .finally(() => fixCtrls.current.delete(ctrl));
  };
  useEffect(() => {
    const ctrls = fixCtrls.current;
    return () => ctrls.forEach((c) => c.abort());
  }, []);
  const apply = (f: (typeof rules)[number], fix: Fix) => {
    onCommit(fix.ops);
    setPreviewing(null);
    setApplied(`「${f.title}」を直しました。「元に戻す」で戻せます。`);
  };
  // 図で見ている案を、画面の図へ映す。指摘が消えた（直った・図が変わった）ら外す
  const previewFinding = rules.find((f) => f.id === previewing);
  const previewOps = previewFinding ? (fixOf(previewFinding)?.ops ?? null) : null;
  const previewJson = previewOps ? JSON.stringify(previewOps) : null;
  useEffect(() => {
    onPreview(previewJson ? (JSON.parse(previewJson) as ModelOp[]) : null);
  }, [onPreview, previewJson]);
  useEffect(() => () => onPreview(null), [onPreview]);

  // ── 幅を左端の境界のドラッグで調整（指摘を大きく読みたいとき）──
  const [width, setWidth] = useReviewWidth();
  const asideRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clampWidth = (w: number) =>
    Math.round(Math.min(Math.max(w, REVIEW_MIN_PX), Math.max(REVIEW_MIN_PX, window.innerWidth - DIAGRAM_MIN_PX)));
  const currentWidth = () => asideRef.current?.getBoundingClientRect().width ?? REVIEW_MIN_PX;

  // 初めて開いたときだけ、AI の点検を始める（図を直したあとは、ボタンで頼み直す）
  useEffect(() => {
    if (ai.status === "idle") runAi();
    // 開いたときの 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside
      ref={asideRef}
      aria-label="フローの点検"
      // 保存した幅が、いまの画面では図を押しつぶす大きさでも、図の分は残す
      style={{ "--review-w": width === null ? "24rem" : `min(${width}px, calc(100vw - ${DIAGRAM_MIN_PX}px))` } as React.CSSProperties}
      className="relative flex min-h-0 shrink-0 flex-col border-t border-black/10 text-sm lg:w-[var(--review-w)] lg:border-l lg:border-t-0 dark:border-white/15"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="フローの点検の幅"
        aria-valuenow={width ?? undefined}
        tabIndex={0}
        title="ドラッグして幅を調整（ダブルクリックで既定に戻す）"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startX: e.clientX, startWidth: currentWidth() };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const start = dragRef.current;
          // 境界は左端にあるので、左へ動かすほど広がる
          if (start) setWidth(clampWidth(start.startWidth + (start.startX - e.clientX)));
        }}
        onPointerUp={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onDoubleClick={() => setWidth(null)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          setWidth(clampWidth(currentWidth() + (e.key === "ArrowLeft" ? KEY_STEP_PX : -KEY_STEP_PX)));
        }}
        className={`absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none lg:block ${
          dragging ? "bg-black/10 dark:bg-white/15" : "hover:bg-black/5 focus-visible:bg-sky-500/20 dark:hover:bg-white/10"
        }`}
      />
      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <h2 className="font-medium">フローの点検</h2>
        <button
          type="button"
          aria-label="閉じる"
          className="rounded px-2 py-0.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="px-4 pb-2 text-xs text-zinc-500">
        チームで描いた図の、気づきにくい抜けや書き方の気になる点です。番号を押すと、図のその手順を示します。
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <Premise model={model} onCommit={onCommit} />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-zinc-500">図の点検（{rules.length} 件）</h3>
          {applied && (
            <p
              role="status"
              className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200"
            >
              {applied}
            </p>
          )}
          {rules.length === 0 && <p className="text-xs text-zinc-500">気になる点は見つかりませんでした。</p>}
          {rules.map((f) => {
            const kind = fixKindOf(f);
            const got = aiFixes[f.id];
            return (
              <FindingCard key={f.id} finding={f} focusStep={focusStep} onFocusStep={onFocusStep}>
                {kind && (
                  <FixBox
                    kind={kind}
                    fix={fixOf(f)}
                    ai={got && got.for === key ? got : undefined}
                    previewing={previewing === f.id}
                    onRequest={() => requestFix(f.id)}
                    onPreview={(on) => setPreviewing(on ? f.id : null)}
                    onApply={(fix) => apply(f, fix)}
                  />
                )}
              </FindingCard>
            );
          })}
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-medium text-zinc-500">
              AI の指摘{ai.status === "done" && !stale ? `（${ai.findings.length} 件）` : ""}
            </h3>
            {ai.status !== "loading" && (
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-500/10"
                onClick={runAi}
              >
                {ai.status === "idle" ? "AI に点検してもらう" : "もう一度点検する"}
              </button>
            )}
          </div>
          {ai.status === "loading" && (
            <p className="flex items-center gap-2 text-xs text-zinc-500" role="status">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent motion-reduce:animate-none" />
              ローカル AI が図を読んでいます（30〜60 秒ほど）…
            </p>
          )}
          {stale && ai.status !== "loading" && (
            <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-400/10 dark:text-amber-200">
              点検のあとで図が変わりました。今の図で確かめるには「もう一度点検する」を押してください。
            </p>
          )}
          {ai.status === "error" && (
            <p className="text-xs text-amber-700 dark:text-amber-300">AI の点検ができませんでした: {ai.message}</p>
          )}
          {ai.status === "done" && (
            <>
              {ai.summary && (
                <p className="rounded border border-black/10 px-2 py-1.5 text-xs text-zinc-600 dark:border-white/15 dark:text-zinc-400">
                  AI はこの図を「{ai.summary}」と読みました。チームの意図と違えば、図の書き方がそう読める形になっているかもしれません。
                </p>
              )}
              {ai.findings.length === 0 && <p className="text-xs text-zinc-500">AI からの指摘はありませんでした。</p>}
              {ai.findings.map((f) => (
                <FindingCard key={f.id} finding={f} focusStep={focusStep} onFocusStep={onFocusStep} />
              ))}
              <p className="text-xs text-zinc-500">AI の指摘は推測を含みます。チームで確かめてから図に反映してください。</p>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}

function FindingCard({
  finding: f,
  focusStep,
  onFocusStep,
  children,
}: {
  finding: Finding;
  focusStep: number;
  onFocusStep: (n: number) => void;
  /** 指摘の下に足すもの（直す案） */
  children?: React.ReactNode;
}) {
  return (
    <article className="flex flex-col gap-1 rounded-md border border-black/10 p-2.5 dark:border-white/15">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={`rounded px-1.5 py-0.5 font-medium ${SEVERITY_CLASS[f.severity]}`}>{SEVERITY_LABEL[f.severity]}</span>
        <span className="rounded border border-black/10 px-1.5 py-0.5 text-zinc-600 dark:border-white/15 dark:text-zinc-400">
          {CATEGORY_LABEL[f.category]}
        </span>
      </div>
      <p className="font-medium leading-snug">{f.title}</p>
      <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{f.detail}</p>
      {f.steps.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <span className="text-xs text-zinc-500">手順</span>
          {f.steps.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={focusStep === n}
              title="図のこの手順を示す"
              className="flex h-6 min-w-6 items-center justify-center rounded-full border border-black/15 px-1.5 text-xs tabular-nums hover:bg-black/5 aria-pressed:border-amber-500 aria-pressed:bg-amber-500 aria-pressed:text-white dark:border-white/20 dark:hover:bg-white/10"
              onClick={() => onFocusStep(focusStep === n ? 0 : n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {children}
    </article>
  );
}

const fixBtn =
  "rounded-md border border-black/15 px-2 py-1 text-xs hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";

/**
 * 指摘に添える「直す案」。コードの案はすぐ出す。AI の案は頼まれてから作る（10〜30 秒）。
 * 「前 → 後」を並べ、図で見る（画面の図だけに映す）・この案で直す、を選ばせる
 */
function FixBox({
  kind,
  fix,
  ai,
  previewing,
  onRequest,
  onPreview,
  onApply,
}: {
  kind: "code" | "ai";
  fix: Fix | null;
  /** AI に頼んだ結果（今の図に対するものだけ） */
  ai?: AiFix;
  previewing: boolean;
  onRequest: () => void;
  onPreview: (on: boolean) => void;
  onApply: (fix: Fix) => void;
}) {
  const box = "mt-1.5 flex flex-col gap-1.5 rounded-md bg-sky-50 p-2 text-xs dark:bg-sky-500/10";
  if (kind === "ai" && !fix) {
    return (
      <div className={box}>
        {ai?.status === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-sky-500 border-t-transparent motion-reduce:animate-none" />
            ローカル AI が直す案を考えています…
          </p>
        ) : (
          <>
            {ai?.status === "done" && <p className="text-zinc-600 dark:text-zinc-300">AI から使える案が出ませんでした。</p>}
            {ai?.status === "error" && <p className="text-amber-700 dark:text-amber-300">案を作れませんでした: {ai.message}</p>}
            <div>
              <button type="button" className={fixBtn} onClick={onRequest}>
                {ai ? "もう一度 AI に案を作ってもらう" : "AI に直す案を作ってもらう"}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }
  if (!fix) return null;
  return (
    <div className={`${box} ${previewing ? "ring-2 ring-sky-500" : ""}`}>
      <p className="font-medium text-sky-800 dark:text-sky-200">直す案{kind === "ai" ? "（AI）" : ""}</p>
      <ul className="flex flex-col gap-1">
        {fix.changes.map((c, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-zinc-500 line-through decoration-zinc-400">{c.before}</span>
            <span aria-hidden className="text-zinc-400">→</span>
            <span className="sr-only">を</span>
            <span className="font-medium text-zinc-800 dark:text-zinc-100">{c.after}</span>
            <span className="sr-only">に</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          aria-pressed={previewing}
          className={`${fixBtn} aria-pressed:border-sky-600 aria-pressed:bg-sky-600 aria-pressed:text-white`}
          onClick={() => onPreview(!previewing)}
        >
          {previewing ? "図で見るのをやめる" : "図で見る"}
        </button>
        <button
          type="button"
          className="rounded-md bg-sky-600 px-2 py-1 text-xs text-white hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-600"
          onClick={() => onApply(fix)}
        >
          この案で直す
        </button>
        {kind === "ai" && (
          <button type="button" className="px-1 text-xs text-sky-700 hover:underline dark:text-sky-300" onClick={onRequest}>
            別の案
          </button>
        )}
      </div>
    </div>
  );
}

/** 業務の前提（目的・きっかけ・頻度）。入力を確定したとき（フォーカスを外す・Enter）に図へ反映する */
function Premise({ model, onCommit }: { model: FlowModel; onCommit: (ops: ModelOp[]) => void }) {
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-zinc-500">業務の前提</h3>
      {PREMISE_FIELDS.map(({ key, label, placeholder }) => {
        const saved = model.scope[key];
        const draftKey = `${key}:${saved}`;
        const value = drafts[draftKey] ?? saved;
        const commit = () => {
          setDrafts({});
          const next = value.replace(/\s+/g, " ").trim();
          if (next !== saved) onCommit([{ op: "scope.set", patch: { [key]: next } }]);
        };
        return (
          <label key={key} className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-zinc-600 dark:text-zinc-400">{label}</span>
            <input
              className="min-w-0 flex-1 rounded-md border border-black/15 bg-transparent px-2 py-1 text-sm dark:border-white/20"
              value={value}
              placeholder={placeholder}
              onChange={(e) => setDrafts({ [draftKey]: e.target.value })}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
              }}
            />
          </label>
        );
      })}
    </section>
  );
}
