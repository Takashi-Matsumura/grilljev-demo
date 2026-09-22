import { visibleSteps } from "@/lib/render/mermaid";
import type { FlowModel, OpenIssue, Step, StepId, StepFlags } from "./types";

/**
 * 会議の参加者が「押せる／答えられる」対象をまとめたもの。
 *
 * 確認待ちのステップ（Step, status: "provisional"）と未解決の論点（OpenIssue）は
 * 別の型だが、画面では 1 つの「要対応」として並べる。差別化ユニオンにするのは、
 * (a) 件数を 1 つの数字で出す、(b) 並び順を「操作できるものが先」に統一する、
 * (c) 出題中の問いの除外ルールをここに閉じ込める、の 3 点のため。
 */
export type AttentionItem =
  | { kind: "step"; id: StepId; step: Step; from: string; to: string }
  | { kind: "issue"; id: string; issue: OpenIssue };

export type ReadinessKey = "purpose" | "trigger" | "frequency";

/** 対象業務についての共通認識（存在意義・きっかけ・頻度）が埋まっているか */
export type ReadinessItem = {
  key: ReadinessKey;
  label: string;
  /** 埋まっていないときに title 属性へ出す、質問の形の補足 */
  hint: string;
  value: string;
};

export type Attention = {
  items: AttentionItem[];
  stepCount: number;
  issueCount: number;
  /** items.length。asked（いま出題中）の論点は含まない */
  total: number;
  flags: { exception: number; tacit: number; personDependent: number };
  /** 常に 3 件。value が "" なら未確定 */
  readiness: ReadinessItem[];
};

const READINESS_DEFS: { key: ReadinessKey; label: string; hint: string }[] = [
  { key: "purpose", label: "目的", hint: "この業務は何のためにありますか。まだ決まっていません" },
  { key: "trigger", label: "きっかけ", hint: "何が起きるとこの業務が始まりますか。まだ決まっていません" },
  { key: "frequency", label: "頻度", hint: "どれくらいの頻度で発生しますか。まだ決まっていません" },
];

/**
 * 「いま出している問い」（status === "asked"）は FacilitatorPane のカードが表示するので、
 * ここには入れない。入れると、同じ論点がカードと要対応リストの二重に出てしまう。
 * この関数は FacilitatorPane が asked を表示している前提に依存する。
 */
export function buildAttention(model: FlowModel): Attention {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;

  const provisional = visibleSteps(model).filter((s) => s.status === "provisional");
  const openIssues = model.issues.filter((i) => i.status !== "answered" && i.status !== "asked");

  // 並びは「操作できるものが先」。ステップは order 昇順（visibleSteps が既にソート済み）、
  // 論点は open → parked。
  const sortedIssues = [...openIssues].sort((a, b) => {
    const rank = (s: OpenIssue["status"]) => (s === "open" ? 0 : 1);
    return rank(a.status) - rank(b.status);
  });

  const items: AttentionItem[] = [
    ...provisional.map((step): AttentionItem => ({
      kind: "step",
      id: step.id,
      step,
      from: nameOf(step.from),
      to: nameOf(step.to),
    })),
    ...sortedIssues.map((issue): AttentionItem => ({ kind: "issue", id: issue.id, issue })),
  ];

  // 掘り下げ軸は provisional に限らず、図全体でいくつ立っているかを数える
  // （業務全体の掘り下げ不足を見せたいので、確認待ちだけに絞らない）。
  const flags = { exception: 0, tacit: 0, personDependent: 0 };
  for (const step of visibleSteps(model)) {
    countFlags(step.flags, flags);
  }

  const readiness: ReadinessItem[] = READINESS_DEFS.map((def) => ({
    ...def,
    value: model.scope[def.key]?.trim() ?? "",
  }));

  return {
    items,
    stepCount: provisional.length,
    issueCount: sortedIssues.length,
    total: items.length,
    flags,
    readiness,
  };
}

function countFlags(flags: StepFlags, into: { exception: number; tacit: number; personDependent: number }) {
  if (flags.exception) into.exception += 1;
  if (flags.tacit) into.tacit += 1;
  if (flags.personDependent) into.personDependent += 1;
}
