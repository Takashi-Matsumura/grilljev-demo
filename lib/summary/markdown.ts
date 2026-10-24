import { notedTargets, notesOn, noteState } from "../model/notes";
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

const ROLE_LABEL: Record<NonNullable<Actor["role"]>, string> = {
  trigger: "起点",
  end: "終点",
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
  // 区切り行の `---` は 3 桁以上要るので、狭い列（「#」など）も 3 桁に揃える
  const widths = header.map((h, i) =>
    Math.max(3, displayWidth(h), ...rows.map((r) => displayWidth(r[i] ?? ""))),
  );
  const pad = (text: string, i: number) => text + " ".repeat(Math.max(0, widths[i] - displayWidth(text)));
  const row = (cells: string[]) => `| ${cells.map(pad).join(" | ")} |`;
  return [row(header), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(row)];
}

const mark = (n: number) => n.toFixed(2);

export function buildSummaryMarkdown(
  model: FlowModel,
  prose: SummaryProse,
  opts: { generatedAt: string; warnings?: string[] },
): string {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const steps = visibleSteps(model);
  const branchOf = (id: string | null) => (id ? model.branches.find((b) => b.id === id) : undefined);
  const lines: string[] = [];

  lines.push(`# 業務分掌: ${model.scope.title || "（対象業務 未設定）"}`, "");
  lines.push(
    `> 業務フロー図から自動で作成した下書きです（${opts.generatedAt}）。` +
      `**「仮」の印は確信が低い項目**、「未確認」は答えが出ていない論点です。必ず参加者で確認してください。`,
    "",
  );
  if (opts.warnings?.length) {
    lines.push("> **まだ下書きの段階です。**", ...opts.warnings.map((w) => `> - ${w}`), "");
  }

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
        ["名称", "種別", "起点・終点", "メンバー", "別名"],
        [...model.actors]
          .sort((x, y) => x.lane - y.lane)
          .map((a) => [
            cell(a.name),
            KIND_LABEL[a.kind],
            a.role ? ROLE_LABEL[a.role] : "",
            cell((a.members ?? []).join("、")),
            cell(a.aliases.join("、")),
          ]),
      ),
    );
    lines.push("");
  }

  // 3. 業務分掌（部署・人ごとの担当業務）
  lines.push(...dutiesSection(model), "");

  // 4. ステップ一覧
  lines.push("## 4. ステップ一覧", "");
  if (steps.length === 0) {
    lines.push("（ステップはまだありません）", "");
  } else {
    lines.push(
      ...table(
        ["#", "送り手", "担当", "受け手", "内容", "種別", "条件", "渡すもの", "確度"],
        steps.map((s, i) => {
          const b = branchOf(s.branchId);
          const cond = b ? `${b.kind} ${b.condition}` : "";
          const label = s.label + flagSuffix(s);
          const certainty =
            s.status === "provisional" ? `**仮** ${mark(s.confidence)}` : mark(s.confidence);
          return [
            String(i + 1),
            cell(nameOf(s.from)),
            cell(s.assignee ?? ""),
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

  // 手順・枠・登場人物に貼った付箋（チームで決めること）。決まったものは、その決まりごととして読める
  const noted = notedTargets(model);
  if (noted.length > 0) {
    lines.push("### 決まりごと（付箋）", "");
    lines.push(
      ...table(
        ["対象", "種別", "決めること", "決まったこと"],
        noted.map(({ note, where }) => [
          cell(where),
          ISSUE_KIND[note.kind],
          cell(note.prompt?.text ?? note.question),
          noteState(note) === "answered" ? cell(note.answer ?? "") : "**未決**",
        ]),
      ),
    );
    lines.push("");
  }

  // 5. フロー図
  lines.push("## 5. フロー図", "");
  if (model.actors.length === 0) {
    lines.push("（図はまだありません）", "");
  } else {
    lines.push("```mermaid", toMermaid(model), "```", "");
  }

  // 6. 例外・属人化・暗黙知
  const flagged = steps.filter((s) => s.flags.exception || s.flags.tacit || s.flags.personDependent);
  lines.push("## 6. 例外・属人化・暗黙知", "");
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

  // 7. 論点
  lines.push("## 7. 論点", "");
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

  // 8. 改善候補
  lines.push("## 8. 改善候補", "");
  if (prose.improvements.length === 0) {
    lines.push("（改善候補は生成されていません）", "");
  } else {
    lines.push("（AI の提案です。根拠は 4・6・7 の内容です）", "", ...prose.improvements.map((x) => `- ${x}`), "");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/**
 * 業務分掌の本体: 部署・人ごとに、その人が送り手になっている手順（＝その人がやる仕事）をまとめる。
 * システムは仕事を受け持つ側ではないので節を作らず、「使うシステム」として各部署の下に書く。
 * 手順の番号はステップ一覧・図と同じ。
 */
function dutiesSection(model: FlowModel): string[] {
  const steps = visibleSteps(model);
  const byId = new Map(model.actors.map((a) => [a.id, a]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const systemName = (a: Actor) => (a.product ? `${a.name}（${a.product}）` : a.name);
  const branchOf = (id: string | null) => (id ? model.branches.find((b) => b.id === id) : undefined);
  const numbered = steps.map((s, i) => ({ s, no: i + 1 }));
  const holders = [...model.actors].filter((a) => a.kind !== "system").sort((x, y) => x.lane - y.lane);

  const lines = ["## 3. 業務分掌（部署・人ごとの担当業務）", ""];
  if (holders.length === 0) return [...lines, "（部署・人の登場人物がいません）"];
  for (const a of holders) {
    const tags = [KIND_LABEL[a.kind], a.role && ROLE_LABEL[a.role]].filter(Boolean).join("・");
    lines.push(`### ${a.name}（${tags}）`, "");
    const own = numbered.filter(({ s }) => s.from === a.id);
    if (own.length === 0) {
      lines.push("（この業務で受け持つ手順はありません）");
    } else {
      lines.push(
        ...table(
          ["#", "担当業務", "相手", "渡すもの", "担当者", "条件"],
          own.map(({ s, no }) => {
            const b = branchOf(s.branchId);
            return [
              String(no),
              cell((s.status === "provisional" ? "**仮** " : "") + s.label + flagSuffix(s)),
              s.to === a.id ? "（自身）" : cell(nameOf(s.to)),
              cell(s.artifact ?? ""),
              cell(s.assignee ?? ""),
              cell(b ? `${b.kind} ${b.condition}` : ""),
            ];
          }),
        ),
      );
    }
    lines.push("");
    const received = [
      ...new Set(
        numbered
          .filter(({ s }) => s.to === a.id && s.from !== a.id && s.artifact)
          .map(({ s, no }) => `${s.artifact}（${nameOf(s.from)}から・手順 ${no}）`),
      ),
    ];
    const systems = [
      ...new Set(
        steps
          .flatMap((s) => (s.from === a.id ? [s.to] : s.to === a.id ? [s.from] : []))
          .map((id) => byId.get(id))
          .filter((x): x is Actor => x?.kind === "system")
          .map(systemName),
      ),
    ];
    const rules = notesOn(model, { kind: "actor", id: a.id });
    if (received.length > 0) lines.push(`- **受け取るもの**: ${received.join("、")}`);
    if (systems.length > 0) lines.push(`- **使うシステム**: ${systems.join("、")}`);
    if (a.members?.length) lines.push(`- **メンバー**: ${a.members.join("、")}`);
    for (const n of rules) {
      const q = n.prompt?.text ?? n.question;
      lines.push(noteState(n) === "answered" ? `- **決まりごと**: ${q} → ${n.answer ?? ""}` : `- **未決**: ${q}`);
    }
    if (received.length + systems.length + (a.members?.length ?? 0) + rules.length > 0) lines.push("");
  }
  return lines;
}
