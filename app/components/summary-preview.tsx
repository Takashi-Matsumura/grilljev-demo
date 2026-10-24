"use client";

import { useEffect, useMemo, useState } from "react";
import { parseMdBlocks, splitBold } from "@/lib/summary/md-blocks";
import { renderMermaidSvg } from "./mermaid-diagram";

function Inline({ text }: { text: string }) {
  return (
    <>
      {splitBold(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** 文書の中の ```mermaid を図にする。描けなければコードのまま出す */
function MermaidBlock({ code }: { code: string }) {
  const [rendered, setRendered] = useState<{ for: string; svg: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void renderMermaidSvg(code)
      .catch(() => null)
      .then((svg) => {
        if (alive) setRendered({ for: code, svg });
      });
    return () => {
      alive = false;
    };
  }, [code]);
  const svg = rendered?.for === code ? rendered.svg : undefined;
  if (svg === undefined) return <p className="text-xs text-zinc-500">図を描いています…</p>;
  if (svg === null) return <pre className="overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-white/10">{code}</pre>;
  return (
    <div
      className="overflow-auto rounded border border-black/10 bg-white p-2 dark:border-white/15 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      // securityLevel: "strict" の Mermaid が生成した SVG のみを入れる
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const HEADING_CLASS: Record<number, string> = {
  1: "text-lg font-semibold",
  2: "mt-3 border-b border-black/10 pb-1 text-base font-semibold dark:border-white/15",
  3: "mt-2 text-sm font-semibold",
};

/** 業務分掌ドキュメント（Markdown）のプレビュー */
export function SummaryPreview({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMdBlocks(markdown), [markdown]);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading": {
            const Tag = `h${Math.min(b.level, 6)}` as "h1";
            return (
              <Tag key={i} className={HEADING_CLASS[b.level] ?? "text-sm font-semibold"}>
                <Inline text={b.text} />
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote
                key={i}
                className="border-l-4 border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-zinc-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-zinc-300"
              >
                {b.lines.map((l, j) =>
                  l.startsWith("- ") ? (
                    <p key={j} className="pl-3 before:mr-1 before:content-['•']">
                      <Inline text={l.slice(2)} />
                    </p>
                  ) : (
                    <p key={j}>
                      <Inline text={l} />
                    </p>
                  ),
                )}
              </blockquote>
            );
          case "list":
            return (
              <ul key={i} className="list-disc pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline text={it} />
                  </li>
                ))}
              </ul>
            );
          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th
                          key={j}
                          className="whitespace-nowrap border border-black/15 bg-zinc-100 px-2 py-1 text-left font-medium dark:border-white/20 dark:bg-white/10"
                        >
                          <Inline text={h} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, k) => (
                          <td key={k} className="border border-black/15 px-2 py-1 align-top dark:border-white/20">
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return b.lang === "mermaid" ? (
              <MermaidBlock key={i} code={b.text} />
            ) : (
              <pre key={i} className="overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-white/10">
                {b.text}
              </pre>
            );
          case "para":
            return (
              <p key={i}>
                <Inline text={b.text} />
              </p>
            );
        }
      })}
    </div>
  );
}
