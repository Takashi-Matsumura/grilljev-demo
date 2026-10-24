import type { Actor, Branch, FlowModel, Step } from "@/lib/model/types";

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

/**
 * 分岐（alt / else / opt / loop）の条件。
 * Mermaid は枠の条件の中の実体参照（#58; など）を戻さず文字化けさせるので、半角の「:」は全角にしてから退避する。
 * （枠の条件は枠の幅で必ず折り返され、空白の無い日本語は語の途中に「-」が入る。Mermaid の仕様で、設定では止められない）
 */
function escCondition(text: string): string {
  return esc(text.replace(/:/g, "："));
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

/**
 * 起点・終点の登場人物は、ライフラインの名前の末尾に印を付ける。Mermaid と drawio で共通。
 * 製品・サービス名（actor.product）はここに入れず、図の側で 2 段目に添える。
 * 再生の強調は、この文字と図の 1 段目の文字の一致で見つけるため（mermaid-diagram.tsx）
 */
export function actorLabel(actor: Actor): string {
  if (actor.role === "trigger") return `${actor.name}［起点］`;
  if (actor.role === "end") return `${actor.name}［終点］`;
  return actor.name;
}

/** この業務の中心となる登場人物。明示した人がいなければ終点の人。どちらもいなければ undefined */
export function focusActorOf<A extends Pick<Actor, "focus" | "role">>(actors: A[]): A | undefined {
  return actors.find((a) => a.focus) ?? actors.find((a) => a.role === "end");
}

/** 中心の登場人物を、図を描いたあと（mermaid-diagram.tsx）に強調するための印。`%% focus: A3` */
export const FOCUS_COMMENT = "%% focus: ";

/**
 * 矢印の形。終端は手順の種類で決める: 依頼（返事を待つ）= 塗りの三角、通知（送るだけ）= 開いた山形、
 * 返答 = 点線と塗りの三角。仮（未確認）は、種類の終端のまま線だけ点線にする（確信がないものを確信ありげに見せない。
 * 以前は種類に関わらず返答と同じ形にしていて、仮の通知と返答が見分けられなかった）
 */
function arrowFor(step: Step): string {
  if (step.status === "provisional") return step.kind === "async" ? "--)" : "-->>";
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

export type MermaidOptions = {
  /** ステップ名の後ろに担当者を付ける（「フローを入力する（田中）」）。画面の表示用。既定は付けない */
  assignees?: boolean;
  /**
   * 中にステップが無い場合（空の枠）に「＋ ここにステップを追加」の注記を描く。/editor の画面用。
   * 書き出し（.mmd）には描かない（空の場合は、条件だけの空の枠になる）
   */
  placeholders?: boolean;
  /**
   * 畳む枠（Branch.groupId）。畳んだ枠は中身を描かず、「▸ alt 条件／条件（3 手順）」の注記 1 つにする。/editor の画面用。
   * ただし中心の登場人物（focusActorOf）が関わる手順がある枠は、枠を残してその手順だけを描き、
   * ほかの手順を「▸ …」の注記 1 つにまとめる（frameStates）。
   * 隠した手順の番号は詰めずに、元の番号のまま描く（autonumber を振り直す）
   */
  collapsed?: ReadonlySet<string>;
};

/** 畳んだ枠の注記の頭。図の上でこの注記を押すと、枠を開く（mermaid-diagram.tsx） */
export const COLLAPSED_MARK = "▸";

const NO_FRAMES: ReadonlySet<string> = new Set();

/** 枠の場合を index 順に */
function armsOf(model: FlowModel, groupId: string): Branch[] {
  return model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
}

function collapsedText(arms: Branch[], steps: number): string {
  const conditions = arms.map((a) => a.condition.trim() || "（未入力）").join("／");
  return `${COLLAPSED_MARK} ${arms[0].kind} ${conditions}（${steps} 手順）`;
}

/**
 * 畳むよう指定された枠の描き方。folded = 注記 1 つ / narrowed = 枠を残し、中心の人が関わる手順だけ描く /
 * open = ふつうに描く（畳む指定が無い枠と、畳んでも隠す手順が無い枠）
 */
export type FrameState = "open" | "narrowed" | "folded";

/** 手順に中心の登場人物が関わるか */
const involves = (step: Step, focusId: string | undefined) =>
  focusId !== undefined && (step.from === focusId || step.to === focusId);

/** 畳むよう指定された枠ごとの描き方（指定の無い枠は入れない＝open） */
function frameStates(model: FlowModel, collapsed: ReadonlySet<string>): Map<string, FrameState> {
  const focusId = focusActorOf(model.actors)?.id;
  const states = new Map<string, FrameState>();
  if (collapsed.size === 0) return states;
  const branchById = new Map(model.branches.map((b) => [b.id, b]));
  const steps = visibleSteps(model);
  for (const groupId of collapsed) {
    const inside = steps.filter((s) => s.branchId !== null && branchById.get(s.branchId)?.groupId === groupId);
    const shown = inside.filter((s) => involves(s, focusId)).length;
    states.set(groupId, shown === 0 ? "folded" : shown < inside.length ? "narrowed" : "open");
  }
  return states;
}

/**
 * 「▸ …」の注記ごとの、隠した手順（collapsedFrames と同じ順）。注記 1 つに畳んだ枠は中の手順すべて、
 * 中心の人の手順だけを残した枠は、中心の人が関わらない手順。folded は注記 1 つに畳んだ枠か（枠が描かれない）
 */
export function hiddenByFold(
  model: FlowModel,
  collapsed: ReadonlySet<string>,
): { groupId: string; folded: boolean; stepIds: string[] }[] {
  const states = frameStates(model, collapsed);
  const focusId = focusActorOf(model.actors)?.id;
  const branchById = new Map(model.branches.map((b) => [b.id, b]));
  const steps = visibleSteps(model);
  return collapsedFrames(model, collapsed).map((groupId) => {
    const folded = states.get(groupId) === "folded";
    const inside = steps.filter((s) => s.branchId !== null && branchById.get(s.branchId)?.groupId === groupId);
    return { groupId, folded, stepIds: inside.filter((s) => folded || !involves(s, focusId)).map((s) => s.id) };
  });
}

/** 空の場合に描く注記の文言。図の上でこの注記を押すと、その場合にステップを足す（mermaid-diagram.tsx） */
export const PLACEHOLDER_TEXT = "＋ ここにステップを追加";

/** 図に描く並び。ステップと、中にステップが無い場合（空の枠） */
export type FlowItem = { step: Step; branch: Branch | undefined } | { step: null; branch: Branch };

/**
 * ステップと空の場合を、図の並び順に並べる。
 * 空の場合は、同じ枠のほかの場合の隣に置く（前の場合の最後のステップの直後。前に無ければ、後ろの場合の
 * 最初のステップの直前）。枠の場合がすべて空のときは、その枠の order の位置に置く（order が無ければ描かない）。
 */
export function flowItems(model: FlowModel): FlowItem[] {
  const steps = visibleSteps(model);
  const branchById = new Map(model.branches.map((b) => [b.id, b]));
  // [order, 同じ order の中での順, item]
  const keyed: [number, number, FlowItem][] = steps.map((step) => [
    step.order,
    0,
    { step, branch: step.branchId ? branchById.get(step.branchId) : undefined },
  ]);
  const filled = new Set(steps.map((s) => s.branchId));
  for (const groupId of new Set(model.branches.map((b) => b.groupId))) {
    const arms = model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
    const base = arms.find((b) => b.order !== undefined)?.order;
    arms.forEach((arm, i) => {
      if (filled.has(arm.id)) return;
      const before = arms.slice(0, i).findLast((b) => filled.has(b.id));
      const after = arms.slice(i + 1).find((b) => filled.has(b.id));
      if (before) {
        const last = steps.findLast((s) => s.branchId === before.id)!;
        keyed.push([last.order, 1 + i, { step: null, branch: arm }]);
      } else if (after) {
        const first = steps.find((s) => s.branchId === after.id)!;
        keyed.push([first.order, -arms.length + i, { step: null, branch: arm }]);
      } else if (base !== undefined) {
        keyed.push([base, i, { step: null, branch: arm }]);
      }
    });
  }
  return keyed.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([, , item]) => item);
}

/** 図に描かれる空の場合を、図の上から順に。n 番目の「＋ ここにステップを追加」が、n 番目の場合（畳んだ枠の中は描かれない） */
export function emptyArms(model: FlowModel, collapsed: ReadonlySet<string> = NO_FRAMES): Branch[] {
  return flowItems(model).flatMap((item) =>
    item.step === null && !collapsed.has(item.branch.groupId) ? [item.branch] : [],
  );
}

/** 図の中の枠（groupId）を、図の上から順に。中にステップも位置も無い枠は描かれないので除く */
export function frameIds(model: FlowModel): string[] {
  return [...new Set(flowItems(model).flatMap((item) => (item.branch ? [item.branch.groupId] : [])))];
}

/**
 * 図に描かれる枠を、図の上から順に（場合を index 順に）。注記 1 つに畳んだ枠は枠として描かれないので除く
 * （中心の人の手順だけを残した枠は、枠として描かれるので入る）
 */
export function drawnFrames(model: FlowModel, collapsed: ReadonlySet<string> = NO_FRAMES): Branch[][] {
  const states = frameStates(model, collapsed);
  return frameIds(model)
    .filter((g) => states.get(g) !== "folded")
    .map((g) => armsOf(model, g));
}

/**
 * 「▸ …」の注記を描く枠を、図の上から順に。k 番目の注記が、k 番目の枠（押すと開く）。
 * 注記 1 つに畳んだ枠と、中心の人の手順だけを残した枠（隠した手順の注記）の両方
 */
export function collapsedFrames(model: FlowModel, collapsed: ReadonlySet<string>): string[] {
  const states = frameStates(model, collapsed);
  return frameIds(model).filter((g) => {
    const state = states.get(g);
    return state === "folded" || state === "narrowed";
  });
}

/**
 * 図の上の「場合」の目印。描いた SVG の中で、何番目の要素かで指す（mermaid-diagram.tsx のドロップ先）。
 * placeholder = 空の場合の「＋ ここにステップを追加」、first = 枠の見出しの条件、else = 2 つ目以降の場合の条件
 */
export type ArmTarget = { kind: "placeholder"; k: number } | { kind: "first"; frame: number } | { kind: "else"; index: number };

/** 図の上の目印から、その場合を割り出す。else を描くのは alt だけ（toMermaid） */
export function armOfTarget(
  model: FlowModel,
  target: ArmTarget,
  collapsed: ReadonlySet<string> = NO_FRAMES,
): Branch | undefined {
  if (target.kind === "placeholder") return emptyArms(model, collapsed)[target.k];
  const frames = drawnFrames(model, collapsed);
  if (target.kind === "first") return frames[target.frame]?.[0];
  return frames.filter((arms) => arms[0].kind === "alt").flatMap((arms) => arms.slice(1))[target.index];
}

export function toMermaid(model: FlowModel, options: MermaidOptions = {}): string {
  const lines: string[] = ["sequenceDiagram", "  autonumber"];
  const focus = focusActorOf(model.actors);
  if (focus) lines.push(`  ${FOCUS_COMMENT}${safeId(focus.id)}`);

  for (const actor of [...model.actors].sort((a, b) => a.lane - b.lane)) {
    // 製品・サービス名は 2 段目に。Mermaid は <br/> の前後を別々の text.actor に描く
    const product = actor.product ? `<br/>${esc(actor.product)}` : "";
    lines.push(`  ${participantKeyword(actor)} ${safeId(actor.id)} as ${esc(actorLabel(actor))}${product}`);
  }

  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);
  // 空の場合の注記は、左端から右端の登場人物にかける（枠の幅いっぱいに出す）
  const span =
    actors.length > 1 ? `${safeId(actors[0].id)},${safeId(actors[actors.length - 1].id)}` : safeId(actors[0]?.id ?? "");
  let openGroup: string | null = null;
  let openBranch: string | null = null;
  const collapsed = options.collapsed ?? NO_FRAMES;
  const states = frameStates(model, collapsed);
  /** 枠として描いた（end で閉じる）か */
  const framed = (g: string | null): g is string => g !== null && states.get(g) !== "folded";
  const items = flowItems(model);
  /** 隠した手順の注記は、その手順に出てくる登場人物の左端から右端までにかける（関係ないレーンにはかけない） */
  const overOf = (hidden: Step[]) => {
    const ids = new Set(hidden.flatMap((h) => [h.from, h.to]));
    const lanes = actors.filter((a) => ids.has(a.id));
    return lanes.length === 0
      ? span
      : lanes.length === 1
        ? safeId(lanes[0].id)
        : `${safeId(lanes[0].id)},${safeId(lanes[lanes.length - 1].id)}`;
  };
  const stepsIn = (groupId: string) =>
    items.flatMap((item) => (item.step && item.branch?.groupId === groupId ? [item.step] : []));
  // 描いたかどうかに関わらず数えた、ステップの番号（autonumber と同じ 1 始まり）
  let number = 0;
  /** 畳んだ枠で番号を飛ばしたので、次に描くステップの前で振り直す */
  let renumber = false;

  for (const { step, branch } of items) {
    const groupId = branch?.groupId ?? null;

    if (groupId !== null && states.get(groupId) === "folded") {
      if (groupId !== openGroup) {
        if (framed(openGroup)) lines.push("  end");
        const hidden = stepsIn(groupId);
        const over = overOf(hidden);
        if (over) lines.push(`  Note over ${over}: ${esc(collapsedText(armsOf(model, groupId), hidden.length))}`);
        openGroup = groupId;
        openBranch = null;
      }
      if (step) {
        number += 1;
        renumber = true;
      }
      continue;
    }

    const narrowed = groupId !== null && states.get(groupId) === "narrowed";
    if (groupId !== openGroup) {
      if (framed(openGroup)) lines.push("  end");
      if (branch) lines.push(`  ${branch.kind} ${escCondition(branch.condition)}`);
      openGroup = groupId;
      openBranch = branch?.id ?? null;
      // 中心の人の手順だけを残した枠。隠した手順は、枠の頭の注記 1 つにまとめる（押すと開く）
      if (narrowed && focus) {
        const hidden = stepsIn(groupId).filter((s) => !involves(s, focus.id));
        lines.push(
          `    Note over ${overOf(hidden)}: ${esc(`${COLLAPSED_MARK} ${focus.name}が関わらない ${hidden.length} 手順を隠しています`)}`,
        );
      }
    } else if (branch && branch.id !== openBranch) {
      // 同じ group の別の枝。else を持てるのは alt だけ
      if (branch.kind === "alt") lines.push(`  else ${escCondition(branch.condition)}`);
      openBranch = branch.id;
    }

    const indent = openGroup !== null ? "    " : "  ";
    if (step === null) {
      // 畳むよう指定された枠には描かない（emptyArms と揃える）
      if (options.placeholders && span && !collapsed.has(groupId ?? "")) {
        lines.push(`${indent}Note over ${span}: ${PLACEHOLDER_TEXT}`);
      }
      continue;
    }
    number += 1;
    if (narrowed && !involves(step, focus?.id)) {
      renumber = true;
      continue;
    }
    if (renumber) {
      lines.push(`  autonumber ${number}`);
      renumber = false;
    }
    const from = safeId(step.from);
    const to = safeId(step.to);
    const label =
      esc(step.label) +
      (options.assignees && step.assignee ? `（${esc(step.assignee)}）` : "") +
      flagSuffix(step) +
      (step.status === "provisional" ? "（仮）" : "");
    lines.push(`${indent}${from}${arrowFor(step)}${to}: ${label}`);

    if (step.artifact) {
      lines.push(
        from === to
          ? `${indent}Note right of ${from}: ${esc(step.artifact)}`
          : `${indent}Note over ${from},${to}: ${esc(step.artifact)}`,
      );
    }
  }

  if (framed(openGroup)) lines.push("  end");
  return lines.join("\n");
}
