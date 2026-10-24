import { notedTargets } from "../model/notes";
import type { Actor, FlowModel, OpenIssue, Step } from "../model/types";
import { flagSuffix, toMermaid, visibleSteps } from "../render/mermaid";
import { controlPoints, dutiesOf, numberRange, raciTable } from "./duties";
import type { FlowText } from "./flow-text";
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
  opts: { generatedAt: string; warnings?: string[]; flow: FlowText; flowByAi: boolean },
): string {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const steps = visibleSteps(model);
  const branchOf = (id: string | null) => (id ? model.branches.find((b) => b.id === id) : undefined);
  const trigger = model.actors.find((a) => a.role === "trigger");
  const end = model.actors.find((a) => a.role === "end");
  const draft = (opts.warnings?.length ?? 0) > 0;
  const lines: string[] = [];

  lines.push(`# 業務分掌: ${model.scope.title || "（対象業務 未設定）"}`, "");
  // 文書情報
  lines.push(
    ...table(
      ["項目", "内容"],
      [
        ["作成日時", opts.generatedAt],
        ["状態", draft ? "**下書き**（下の未完成の点を参照）" : "確認待ち（参加者で確認して確定してください）"],
        ["対象範囲", trigger || end ? `${trigger?.name ?? "（起点 未設定）"} から ${end?.name ?? "（終点 未設定）"} まで` : "（起点・終点 未設定）"],
        ["手順の数", `${steps.length}`],
      ],
    ),
    "",
  );
  lines.push(
    "> 業務フロー図から自動で作成しました。**「仮」の印は確信が低い項目**です。必ず参加者で確認してください。" +
      "（番号）は図の手順番号です。",
    "",
  );
  if (draft) lines.push("> **まだ下書きの段階です。**", ...opts.warnings!.map((w) => `> - ${w}`), "");

  // 1. 業務概要
  lines.push("## 1. 業務概要", "");
  lines.push(`- **目的**: ${model.scope.purpose || "（未確定）"}`);
  if (model.scope.trigger) lines.push(`- **きっかけ**: ${model.scope.trigger}`);
  if (model.scope.frequency) lines.push(`- **頻度**: ${model.scope.frequency}`);
  lines.push("");
  lines.push(prose.overview ? `${prose.overview}（AI が図から要約した文です）` : "（概要は生成されていません）", "");

  // 2. 部署別の分掌（業務分掌の本体: 責任と権限）
  lines.push("## 2. 部署別の分掌", "");
  const duties = dutiesOf(model);
  if (duties.length === 0) {
    lines.push("（手順を受け持つ部署・人がまだいません）", "");
  } else {
    for (const d of duties) {
      const tags = [KIND_LABEL[d.actor.kind], d.actor.role && ROLE_LABEL[d.actor.role]].filter(Boolean).join("・");
      lines.push(`### ${d.actor.name}（${tags}）`, "");
      lines.push(`- **責任**: ${d.tasks.length > 0 ? d.tasks.join("、") : "（受け持つ手順はありません）"}`);
      if (d.decisions.length > 0) lines.push(`- **判断・承認**: ${d.decisions.join("、")}`);
      if (d.received.length > 0 || d.handed.length > 0) {
        lines.push(`- **受け取る**: ${d.received.join("、") || "—"} ／ **引き渡す**: ${d.handed.join("、") || "—"}`);
      }
      if (d.systems.length > 0) lines.push(`- **使うシステム**: ${d.systems.join("、")}`);
      if (d.assignees.length > 0 || d.actor.members?.length) {
        const members = d.actor.members?.length ? `メンバー ${d.actor.members.join("、")}` : "";
        lines.push(`- **担当者**: ${[members, d.assignees.join("、")].filter(Boolean).join(" ／ 実施: ")}`);
      }
      for (const r of d.rules) lines.push(`- **決まりごと**: ${r}`);
      lines.push("");
    }
  }

  // 3. 責任分担表（RACI。業務のまとまり × 部署）
  const noOf = new Map(steps.map((s, i) => [s.id, i + 1]));
  const blockLabel = (b: FlowText["blocks"][number]) => b.name ?? b.title;
  lines.push("## 3. 責任分担表", "");
  const raci = raciTable(
    model,
    opts.flow.blocks
      .filter((b) => b.stepIds.length > 0)
      .map((b) => ({
        label: `${blockLabel(b)}（${numberRange(b.stepIds.map((id) => noOf.get(id) ?? 0))}）`,
        stepIds: b.stepIds,
      })),
  );
  if (raci.rows.length === 0 || raci.columns.length === 0) {
    lines.push("（ステップはまだありません）", "");
  } else {
    lines.push(
      "（**A** 承認する ／ **R** 行う ／ **C** 依頼を受けて応える ／ **I** 受け取る。図の手順から当てたもので、" +
        "承認の手順が無いまとまりは A が空になります）",
      "",
      ...table(["業務のまとまり", ...raci.columns], raci.rows.map((r) => [cell(r.label), ...r.cells.map((c) => (c === "A" ? "**A**" : c))])),
      "",
    );
  }

  // 4. 業務の流れ（まとまりごとの箇条書き）
  lines.push("## 4. 業務の流れ", "");
  if (opts.flow.blocks.length === 0) {
    lines.push("（ステップはまだありません）", "");
  } else {
    lines.push(
      `（${opts.flowByAi ? "文は AI が図から書き起こしたものです" : "AI が使えなかったため、図の手順名をそのまま並べています"}。` +
        `${opts.flow.blocks.some((b) => b.name) ? "まとまりの名前も AI が付けたものです" : ""}）`,
      "",
    );
    if (opts.flow.intro) lines.push(opts.flow.intro, "");
    for (const b of opts.flow.blocks) {
      lines.push(`### ${b.name ? `${b.name}（${b.title}）` : b.title}`, "", ...b.items.map((x) => `- ${x}`), "");
    }
    if (opts.flow.outro) lines.push(`**終了**: ${opts.flow.outro}`, "");
  }

  // 5. フロー図
  lines.push("## 5. フロー図", "");
  if (model.actors.length === 0) {
    lines.push("（図はまだありません）", "");
  } else {
    lines.push("```mermaid", toMermaid(model), "```", "");
  }

  // 6. 統制上の確認点（職務分離・承認・属人化・例外など）
  lines.push("## 6. 統制上の確認点", "");
  const points = controlPoints(model);
  if (points.length === 0) {
    lines.push("（図から分かる確認点は見つかっていません）", "");
  } else {
    lines.push("（手順名の言葉から当たりを付けたものです。実際の運用を確かめてください）", "", ...points.map((p) => `- ${p}`), "");
  }

  // 7. 未決事項と決まったこと（論点と付箋をまとめる。付箋も論点なので、対象が分かるものは対象を添える）
  lines.push("## 7. 未決事項と決まったこと", "");
  const whereOf = new Map(notedTargets(model).map(({ note, where }) => [note.id, where]));
  const pending = model.issues.filter((i) => i.status !== "answered");
  const decided = model.issues.filter((i) => i.status === "answered");
  if (model.issues.length === 0) {
    lines.push("（未決事項はありません）", "");
  } else {
    if (pending.length > 0) {
      lines.push("### 未決事項", "");
      lines.push(
        ...table(
          ["対象", "種別", "決めること", "状態"],
          pending.map((i) => [cell(whereOf.get(i.id) ?? "全体"), ISSUE_KIND[i.kind], cell(i.prompt?.text ?? i.question), ISSUE_STATUS[i.status]]),
        ),
        "",
      );
    }
    if (decided.length > 0) {
      lines.push("### 決まったこと", "");
      lines.push(
        ...table(
          ["対象", "種別", "決めたこと", "答え"],
          decided.map((i) => [cell(whereOf.get(i.id) ?? "全体"), ISSUE_KIND[i.kind], cell(i.prompt?.text ?? i.question), cell(i.answer ?? "")]),
        ),
        "",
      );
    }
  }

  // 8. 改善候補
  lines.push("## 8. 改善候補", "");
  if (prose.improvements.length === 0) {
    lines.push("（改善候補は生成されていません）", "");
  } else {
    lines.push("（AI の提案です。根拠は 6・7 と付録の内容です）", "", ...prose.improvements.map((x) => `- ${x}`), "");
  }

  // 付録: 関係者とステップ一覧（細かい表は後ろにまとめる）
  lines.push("## 付録", "");
  lines.push("### 関係者", "");
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
      "",
    );
  }
  lines.push("### ステップ一覧", "");
  if (steps.length === 0) {
    lines.push("（ステップはまだありません）", "");
  } else {
    lines.push(
      ...table(
        ["#", "送り手", "担当", "受け手", "内容", "種別", "条件", "渡すもの", "確度"],
        steps.map((s, i) => {
          const b = branchOf(s.branchId);
          const certainty = s.status === "provisional" ? `**仮** ${mark(s.confidence)}` : mark(s.confidence);
          return [
            String(i + 1),
            cell(nameOf(s.from)),
            cell(s.assignee ?? ""),
            cell(nameOf(s.to)),
            cell(s.label + flagSuffix(s)),
            MESSAGE_LABEL[s.kind],
            cell(b ? `${b.kind} ${b.condition}` : ""),
            cell(s.artifact ?? ""),
            certainty,
          ];
        }),
      ),
      "",
    );
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
