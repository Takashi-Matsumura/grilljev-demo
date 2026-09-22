"use client";

import { useRef, useState } from "react";
import { download } from "./download";
import type { FlowModel } from "@/lib/model/types";
import { toDrawio } from "@/lib/render/drawio";
import { DisclosureIcon } from "./disclosure-icon";
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

const TRIGGER_BTN =
  "flex cursor-pointer list-none items-center gap-1.5 rounded-md border border-black/15 px-2.5 py-1 text-sm hover:bg-black/5 [&::-webkit-details-marker]:hidden dark:border-white/20 dark:hover:bg-white/10";

/** 図の書き出し（.drawio / .mmd / .svg）。「書き出し ▾」の下に3形式を畳む。 */
export function ExportButtons({ model, mermaidCode, svg, empty }: Props) {
  const [message, setMessage] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  const run = (format: ExportFormat) => {
    try {
      const name = exportFileName(model.scope.title, format);
      if (format === "drawio") download(name, EXPORT_MIME.drawio, toDrawio(model));
      else if (format === "mmd") download(name, EXPORT_MIME.mmd, `${mermaidCode}\n`);
      else if (svg) download(name, EXPORT_MIME.svg, finalizeSvg(svg));
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
        <div className="absolute bottom-full right-0 z-10 mb-1 w-56 rounded-md border border-black/15 bg-background p-1 shadow-lg dark:border-white/20">
          {BUTTONS.map((b) => {
            const disabled = b.format === "svg" && svg === null;
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
