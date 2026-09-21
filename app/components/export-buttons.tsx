"use client";

import { useState } from "react";
import { download } from "./download";
import type { FlowModel } from "@/lib/model/types";
import { toDrawio } from "@/lib/render/drawio";
import {
  EXPORT_MIME,
  exportFileName,
  finalizeSvg,
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
  { format: "svg", label: ".svg", hint: "画像として使えます（画面に描画された図そのもの）" },
];

/** 図の書き出し（.drawio / .mmd / .svg）。 */
export function ExportButtons({ model, mermaidCode, svg, empty }: Props) {
  const [message, setMessage] = useState<string | null>(null);

  const run = (format: ExportFormat) => {
    try {
      const name = exportFileName(model.scope.title, format);
      if (format === "drawio") download(name, EXPORT_MIME.drawio, toDrawio(model));
      else if (format === "mmd") download(name, EXPORT_MIME.mmd, `${mermaidCode}\n`);
      else if (svg) download(name, EXPORT_MIME.svg, finalizeSvg(svg));
      setMessage(`${name} を保存しました`);
    } catch (e) {
      setMessage(e instanceof Error ? `保存できませんでした: ${e.message}` : "保存できませんでした");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-zinc-500">書き出し</span>
      {BUTTONS.map((b) => {
        const disabled = empty || (b.format === "svg" && svg === null);
        return (
          <button
            key={b.format}
            type="button"
            onClick={() => run(b.format)}
            disabled={disabled}
            title={disabled && !empty ? "図を描画しています…" : b.hint}
            className="rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 disabled:opacity-40 disabled:hover:bg-transparent dark:border-white/20 dark:hover:bg-white/10"
          >
            ⤓ {b.label}
          </button>
        );
      })}
      {message && (
        <span role="status" className="min-w-0 break-words text-xs text-zinc-500">
          {message}
        </span>
      )}
    </div>
  );
}
