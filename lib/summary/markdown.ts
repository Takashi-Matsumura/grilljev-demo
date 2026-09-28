import type { Actor, FlowModel, OpenIssue, Step } from "../model/types";
import { flagSuffix, toMermaid, visibleSteps } from "../render/mermaid";
import type { SummaryProse } from "./prose";

/**
 * FlowModel → 業務分掌ドキュメント（Markdown）。純関数。
 *
 * **事実の部分（関係者・ステップ・図・論点）はモデルからコードで作る**。gemma が書くのは
 * 「概要」と「改善候補」だけ（lib/summary/generate.ts）。表の中身を gemma に書かせると、
 * 発話に無い担当者や手順が紛れ込むため。確度の低い項目には印を付ける。
 */

const KIND_LABEL: Record<Actor["kind"], string> = {
  person: "個人",
  role: "部署・役職",
  system: "システム",
  external: "社外",
  unknown: "不明",
};

const MESSAGE_LABEL: Record<Step["kind"], string> = {
  sync: "依頼",
  async: "通知",
  reply: "返答",
  self: "自己完結",
};

const ISSUE_STATUS: Record<OpenIssue["status"], string> = {
  open: "未確認",
  asked: "質問済み",
  answered: "回答済み",
  parked: "保留",
};

const ISSUE_KIND: Record<OpenIssue["kind"], string> = {
  purpose: "目的",
  who: "担当",
  when: "時期",
  criteria: "判断基準",
  exception: "例外",
  tool: "道具",
  handoff: "引継ぎ",
};

/** 表のセルに入れる文字列。`|` と改行は表を壊すので退避する。 */
export function cell(text: string): string {
  const s = text.replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
  return s === "" ? "—" : s;
}

/**
 * 表示上の桁数。CJK・かな・全角記号は 2 桁で数える。
 *
 * Unicode の East Asian Width で言う Wide(W) と Fullwidth(F) だけを 2 桁にし、
 * Ambiguous(A) は 1 桁のままにしている。和文等幅（BIZ UDGothic）での実測で、
 * `—` `–` は 1 桁、`・`「」（）、あ 漢 ー ％ ～ は 2 桁だったため。
 */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    const wide =
      (c >= 0x1100 && c <= 0x115f) || // ハングル字母
      (c >= 0x2e80 && c <= 0x303e) || // CJK 部首・記号（「」、。など）
      (c >= 0x3041 && c <= 0x33ff) || // かな・カタカナ・互換
      (c >= 0x3400 && c <= 0x4dbf) || // 漢字 拡張A
      (c >= 0x4e00 && c <= 0x9fff) || // 漢字
      (c >= 0xa000 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || // ハングル
      (c >= 0xf900 && c <= 0xfaff) || // 互換漢字
      (c >= 0xfe30 && c <= 0xfe6f) || // 互換形・小字形
      (c >= 0xff00 && c <= 0xff60) || // 全角英数・記号
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x20000 && c <= 0x3fffd); // 拡張漢字
    w += wide ? 2 : 1;
  }
  return w;
}

/**
 * Markdown の表。**セルを桁数で詰めて出す。**
 *
 * 詰めないと、和文等幅フォントで見ても `|` が縦に揃わない（元の文字数が違うため）。
 * 書き出した .md を素のエディタで開いたときにも読みやすくなる。
 */
export function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))),
  );
  const pad = (text: string, i: number) => text + " ".repeat(Math.max(0, widths[i] - displayWidth(text)));
  const row = (cells: string[]) => `| ${cells.map(pad).join(" | ")} |`;
  return [row(header), `| ${widths.map((w) => "-".repeat(Math.max(3, w))).join(" | ")} |`, ...rows.map(row)];
}

const mark = (n: number) => n.toFixed(2);

export function buildSummaryMarkdown(
  model: FlowModel,
  prose: SummaryProse,
  opts: { generatedAt: string },
): string {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const steps = visibleSteps(model);
  const branchOf = (id: string | null) => (id ? model.branches.find((b) => b.id === id) : undefined);
  const lines: string[] = [];

  lines.push(`# 業務分掌: ${model.scope.title || "（対象業務 未設定）"}`, "");
  lines.push(
    `> 会議の音声から自動で作成した下書きです（${opts.generatedAt}）。` +
      `**「仮」の印は確信が低い項目**、「未確認」は答えが出ていない論点です。必ず参加者で確認してください。`,
    "",
  );

  // 1. 業務概要
  lines.push("## 1. 業務概要", "");
  lines.push(`- **目的**: ${model.scope.purpose || "（未確定）"}`);
  if (model.scope.trigger) lines.push(`- **きっかけ**: ${model.scope.trigger}`);
  if (model.scope.frequency) lines.push(`- **頻度**: ${model.scope.frequency}`);
  lines.push("");
  lines.push(prose.overview ? `${prose.overview}（AI が図から要約した文です）` : "（概要は生成されていません）", "");

  // 2. 関係者
  lines.push("## 2. 関係者", "");
  if (model.actors.length === 0) {
    lines.push("（関係者はいません）", "");
  } else {
    lines.push(
      ...table(
        ["名称", "種別", "別名"],
        [...model.actors]
          .sort((x, y) => x.lane - y.lane)
          .map((a) => [cell(a.name), KIND_LABEL[a.kind], cell(a.aliases.join("、"))]),
      ),
    );
    lines.push("");
  }

  // 3. ステップ一覧
  lines.push("## 3. ステップ一覧", "");
  if (steps.length === 0) {
    lines.push("（ステップはまだありません）", "");
  } else {
    lines.push(
      ...table(
        ["#", "送り手", "受け手", "内容", "種別", "条件", "書類・道具", "確度"],
        steps.map((s, i) => {
          const b = branchOf(s.branchId);
          const cond = b ? `${b.kind} ${b.condition}` : "";
          const label = s.label + flagSuffix(s);
          const certainty =
            s.status === "provisional" ? `**仮** ${mark(s.confidence)}` : mark(s.confidence);
          return [
            String(i + 1),
            cell(nameOf(s.from)),
            cell(nameOf(s.to)),
            cell(label),
            MESSAGE_LABEL[s.kind],
            cell(cond),
            cell(s.artifact ?? ""),
            certainty,
          ];
        }),
      ),
    );
    lines.push("");
  }

  // 4. フロー図
  lines.push("## 4. フロー図", "");
  if (model.actors.length === 0) {
    lines.push("（図はまだありません）", "");
  } else {
    lines.push("```mermaid", toMermaid(model), "```", "");
  }

  // 5. 例外・属人化・暗黙知
  const flagged = steps.filter((s) => s.flags.exception || s.flags.tacit || s.flags.personDependent);
  lines.push("## 5. 例外・属人化・暗黙知", "");
  if (flagged.length === 0) {
    lines.push("（該当するステップは見つかっていません）", "");
  } else {
    for (const s of flagged) {
      const kinds = [s.flags.exception && "例外", s.flags.tacit && "暗黙知", s.flags.personDependent && "属人化"]
        .filter(Boolean)
        .join("・");
      lines.push(`- ${nameOf(s.from)} → ${nameOf(s.to)}「${s.label}」: ${kinds}`);
    }
    lines.push("");
  }

  // 6. 論点
  lines.push("## 6. 論点", "");
  if (model.issues.length === 0) {
    lines.push("（論点はありません）", "");
  } else {
    const order: OpenIssue["status"][] = ["open", "asked", "parked", "answered"];
    const sorted = [...model.issues].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    lines.push(
      ...table(
        ["状態", "種別", "論点", "回答"],
        sorted.map((i) => [
          ISSUE_STATUS[i.status],
          ISSUE_KIND[i.kind],
          cell(i.prompt?.text ?? i.question),
          cell(i.answer ?? ""),
        ]),
      ),
    );
    lines.push("");
  }

  // 7. 改善候補
  lines.push("## 7. 改善候補", "");
  if (prose.improvements.length === 0) {
    lines.push("（改善候補は生成されていません）", "");
  } else {
    lines.push("（AI の提案です。根拠は 3・5・6 の内容です）", "", ...prose.improvements.map((x) => `- ${x}`), "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
