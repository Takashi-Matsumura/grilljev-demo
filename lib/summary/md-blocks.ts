/**
 * 業務分掌ドキュメント（lib/summary/markdown.ts が作る Markdown）を、プレビュー用のかたまりに分ける。純関数。
 *
 * 汎用の Markdown パーサは入れない。読むのは自分で作った文書だけなので、使っている書き方
 * （見出し・引用・箇条書き・表・コードブロック・段落と、行内の **太字**）が読めれば足りる。
 */

export type MdBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; items: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "para"; text: string };

/** 表の 1 行をセルに分ける。`\|` はセルの中の `|`（markdown.ts の cell() が退避したもの） */
function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const isSeparator = (line: string) => /^\|[\s|:-]+\|$/.test(line.trim());

export function parseMdBlocks(markdown: string): MdBlock[] {
  const lines = markdown.split(/\r?\n/);
  const out: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i += 1; // 閉じの ```
      out.push({ kind: "code", lang: fence[1], text: body.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push({ kind: "quote", lines: body });
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        if (!isSeparator(lines[i])) rows.push(cells(lines[i]));
        i += 1;
      }
      out.push({ kind: "table", header: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (/^- /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^- /.test(lines[i])) items.push(lines[i++].slice(2));
      out.push({ kind: "list", items });
      continue;
    }
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    // 1 行目は必ず取る（どの書き方にも当たらなかった行で止まらないように）
    const body: string[] = [lines[i++]];
    while (i < lines.length && lines[i].trim() !== "" && !/^(#|>|\||- |```)/.test(lines[i].trim())) {
      body.push(lines[i++]);
    }
    out.push({ kind: "para", text: body.join(" ") });
  }
  return out;
}

/** 行内の **太字** を分ける。bold が true の断片を太字で出す */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter((s) => s !== "")
    .map((s) => (/^\*\*[^*]+\*\*$/.test(s) ? { text: s.slice(2, -2), bold: true } : { text: s, bold: false }));
}
