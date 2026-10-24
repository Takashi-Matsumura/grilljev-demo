"use client";

import { useState } from "react";
import { download } from "./download";
import { notedTargets } from "@/lib/model/notes";
import type { FlowModel } from "@/lib/model/types";
import { toDrawio } from "@/lib/render/drawio";
import { addNotesToSvg } from "@/lib/render/svg-notes";
import { DisclosureIcon } from "./disclosure-icon";
import { toSvg11 } from "./svg11";
import { useCloseOnOutside } from "./use-close-on-outside";
import {
  EXPORT_MIME,
  exportFileName,
  finalizeSvg,
  toFlowJson,
  type ExportFormat,
} from "@/lib/render/export";

type Props = {
  /** 書き出す図（いま画面に出している図。過去のタブなら過去の図） */
  model: FlowModel;
  /** その図の Mermaid コード。.mmd にそのまま書き出す */
  mermaidCode: string;
  /** 描画済みの SVG。まだ描画されていない・古いときは null（.svg は押せない） */
  svg: string | null;
  /** 図が描けない（アクターが 1 人もいない）とき true */
  empty: boolean;
};

const BUTTONS: { format: ExportFormat; label: string; hint: string }[] = [
  { format: "drawio", label: ".drawio", hint: "draw.io（diagrams.net）で開いて編集できます" },
  { format: "mmd", label: ".mmd", hint: "Mermaid のコード。GitHub や Obsidian でそのまま描画できます" },
  { format: "svg", label: ".svg", hint: "画像として使えます（画面に描画された図そのもの。畳んだ枠は開いて書き出します）" },
  {
    format: "svg11",
    label: ".svg（SVG 1.1）",
    hint: "Canva など、ふつうの .svg を取り込めないアプリ向け。見た目を CSS ではなく要素ごとの属性で書きます",
  },
  {
    format: "json",
    label: ".json（データ）",
    hint: "業務フローのデータそのもの（登場人物・手順・分岐・付箋など）。別のアプリへ取り込むときに使います",
  },
];

const TRIGGER_BTN =
  "flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 [&::-webkit-details-marker]:hidden dark:border-white/20 dark:hover:bg-white/10";

/** 図の書き出し（.drawio / .mmd / .svg / .json）。「書き出し ▾」の下に各形式を畳む。 */
export function ExportButtons({ model, mermaidCode, svg, empty }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  // 付箋（手順・枠・登場人物に貼った、チームで決めること）を .svg に入れるか。付箋がある図では、既定で入れる
  const noteCount = notedTargets(model).length;
  const [withNotes, setWithNotes] = useState(true);
  const detailsRef = useCloseOnOutside();

  const run = (format: ExportFormat) => {
    try {
      const name = exportFileName(model.scope.title, format);
      const image = svg && withNotes && noteCount > 0 ? addNotesToSvg(svg, model) : svg;
      if (format === "drawio") download(name, EXPORT_MIME.drawio, toDrawio(model));
      else if (format === "mmd") download(name, EXPORT_MIME.mmd, `${mermaidCode}\n`);
      else if (format === "json") download(name, EXPORT_MIME.json, toFlowJson(model));
      else if (format === "svg11" && image) download(name, EXPORT_MIME.svg11, toSvg11(image));
      else if (image) download(name, EXPORT_MIME.svg, finalizeSvg(image));
      setMessage(`${name} を保存しました`);
    } catch (e) {
      setMessage(e instanceof Error ? `保存できませんでした: ${e.message}` : "保存できませんでした");
    } finally {
      if (detailsRef.current) detailsRef.current.open = false;
    }
  };

  if (empty) {
    return (
      <button type="button" disabled title="図がまだありません" className={`${TRIGGER_BTN} disabled:opacity-40`}>
        ⤓ 書き出し
        <DisclosureIcon />
      </button>
    );
  }

  return (
    <div className="relative flex items-center gap-2">
      <details ref={detailsRef} className="group relative">
        <summary className={TRIGGER_BTN}>
          ⤓ 書き出し
          <DisclosureIcon />
        </summary>
        {/* ボタンの左端に揃えて右へ広げる。右端に揃えると、ボタンが画面の左端にあるとき（削除したステップが無い図など）左にはみ出して見えなくなる */}
        <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-md border border-black/15 bg-background p-1 shadow-lg dark:border-white/20">
          {BUTTONS.map((b) => {
            const disabled = (b.format === "svg" || b.format === "svg11") && svg === null;
            return (
              <button
                key={b.format}
                type="button"
                onClick={() => run(b.format)}
                disabled={disabled}
                title={disabled ? "図を描画しています…" : b.hint}
                className="flex w-full items-center justify-start rounded px-2 py-1.5 text-left text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:hover:bg-white/10"
              >
                {b.label}
              </button>
            );
          })}
          {noteCount > 0 && (
            <label
              className="mt-1 flex items-center gap-1.5 border-t border-black/10 px-2 pb-1 pt-2 text-xs text-zinc-600 dark:border-white/15 dark:text-zinc-400"
              title="図の横に番号付きの印を付け、図の下に付箋の一覧（決めること・決まったこと）を足します"
            >
              <input type="checkbox" checked={withNotes} onChange={(e) => setWithNotes(e.target.checked)} />
              .svg に付箋を入れる（{noteCount} 件）
            </label>
          )}
        </div>
      </details>
      {message && (
        <span role="status" className="min-w-0 break-words text-xs text-zinc-500">
          {message}
        </span>
      )}
    </div>
  );
}
