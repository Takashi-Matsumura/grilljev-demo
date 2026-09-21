import type { Actor, FlowModel, Step } from "@/lib/model/types";

/**
 * FlowModel → Mermaid の sequenceDiagram。
 *
 * 意図的に使わない構文: `activate` / `deactivate` と `->>+` / `-->>-`。
 * 入れ子が 1 箇所でも崩れると図全体が描画不能になり、会議中に育てる用途では事故が多すぎる。
 * 矢印は「同期 ->> / 非同期 -) / 返答 -->>」に限定して安定を取る。
 */

/** Mermaid のラベルを壊す文字を、数値実体参照へ 1 パスで退避する。 */
const ENTITY: Record<string, string> = {
  "#": "#35;",
  ";": "#59;",
  "<": "#lt;",
  ">": "#gt;",
  ":": "#58;",
};

function esc(text: string): string {
  const escaped = text
    .replace(/[#;<>:]/g, (c) => ENTITY[c])
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
  return escaped || "（未入力）";
}

/** participant id は英数字と _ のみ。日本語は `as` の後ろに置く。 */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * ops-grill の掘り下げ軸（例外・暗黙知・属人化）を、ステップ名の末尾に付ける記号。
 * 図の上で「ここは聞き足りない」が見えるようにする。Mermaid と drawio で共通。
 */
export function flagSuffix(step: Step): string {
  const marks: string[] = [];
  if (step.flags.exception) marks.push("［例外］");
  if (step.flags.tacit) marks.push("［暗黙知］");
  if (step.flags.personDependent) marks.push("［属人］");
  return marks.join("");
}

function arrowFor(step: Step): string {
  // 未確認は点線で描き、確信がないものを確信ありげに見せない
  if (step.status === "provisional") return "-->>";
  switch (step.kind) {
    case "async":
      return "-)";
    case "reply":
      return "-->>";
    default:
      return "->>";
  }
}

function participantKeyword(actor: Actor): "actor" | "participant" {
  return actor.kind === "person" || actor.kind === "role" ? "actor" : "participant";
}

/** 描画対象（取り消し済みと、アクターが欠けたものを除く）を並び順どおりに返す。 */
export function visibleSteps(model: FlowModel): Step[] {
  const known = new Set(model.actors.map((a) => a.id));
  return model.steps
    .filter((s) => s.status !== "retracted" && known.has(s.from) && known.has(s.to))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** アクターが 1 人もいなければ図にできない（呼び出し側で空状態を出す）。 */
export function hasDiagram(model: FlowModel): boolean {
  return model.actors.length > 0;
}

export function toMermaid(model: FlowModel): string {
  const lines: string[] = ["sequenceDiagram", "  autonumber"];

  for (const actor of [...model.actors].sort((a, b) => a.lane - b.lane)) {
    lines.push(`  ${participantKeyword(actor)} ${safeId(actor.id)} as ${esc(actor.name)}`);
  }

  const branchById = new Map(model.branches.map((b) => [b.id, b]));
  let openGroup: string | null = null;
  let openBranch: string | null = null;

  for (const step of visibleSteps(model)) {
    const branch = step.branchId ? branchById.get(step.branchId) : undefined;
    const groupId = branch?.groupId ?? null;

    if (groupId !== openGroup) {
      if (openGroup !== null) lines.push("  end");
      if (branch) lines.push(`  ${branch.kind} ${esc(branch.condition)}`);
      openGroup = groupId;
      openBranch = branch?.id ?? null;
    } else if (branch && branch.id !== openBranch) {
      // 同じ group の別の枝。else を持てるのは alt だけ
      if (branch.kind === "alt") lines.push(`  else ${esc(branch.condition)}`);
      openBranch = branch.id;
    }

    const indent = openGroup !== null ? "    " : "  ";
    const from = safeId(step.from);
    const to = safeId(step.to);
    const label =
      esc(step.label) + flagSuffix(step) + (step.status === "provisional" ? "（仮）" : "");
    lines.push(`${indent}${from}${arrowFor(step)}${to}: ${label}`);

    if (step.artifact) {
      lines.push(
        from === to
          ? `${indent}Note right of ${from}: ${esc(step.artifact)}`
          : `${indent}Note over ${from},${to}: ${esc(step.artifact)}`,
      );
    }
  }

  if (openGroup !== null) lines.push("  end");
  return lines.join("\n");
}
