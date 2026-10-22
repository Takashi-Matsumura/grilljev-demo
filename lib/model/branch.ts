import { visibleSteps } from "../render/mermaid";
import type { Branch, FlowModel, ModelOp, Step, StepId } from "./types";

/**
 * 分岐（枠）を手で組み立てる ops。純粋関数（/editor の分岐の操作。後で音声からも同じ関数を使う）。
 * 枠は先に空で作り（addFrameOps）、あとから場合ごとにステップを足す（add-step.ts の into）。
 *
 * 枠は「図の並びで連続しているステップ」を囲んで描かれる（toMermaid）。同じ枠（groupId）の
 * ステップが途中で途切れると枠が 2 つに割れるので、枠に出し入れするときは order も動かして、
 * 枠の中身が連続したままになるようにする。場合（alt の else）は index の順に並べる。
 */

export const BRANCH_KINDS: { kind: Branch["kind"]; label: string; hint: string }[] = [
  { kind: "alt", label: "場合分け", hint: "条件によってやることが変わる（もし〜なら / そうでなければ）" },
  { kind: "opt", label: "やるときだけ", hint: "条件を満たすときだけやる" },
  { kind: "loop", label: "繰り返し", hint: "条件を満たす間、繰り返す" },
];

export const branchKindLabel = (kind: Branch["kind"]) => BRANCH_KINDS.find((k) => k.kind === kind)?.label ?? kind;

function nextId(prefix: string, ids: string[]): string {
  const used = ids.map((id) => Number(new RegExp(`^${prefix}(\\d+)$`).exec(id)?.[1] ?? 0));
  return `${prefix}${Math.max(0, ...used) + 1}`;
}

/** 枠（groupId）の場合を index 順に */
export function groupArms(model: FlowModel, groupId: string): Branch[] {
  return model.branches.filter((b) => b.groupId === groupId).sort((a, b) => a.index - b.index);
}

/** rest（並び）の at 番目の手前に入れるときの order */
function orderAt(rest: Step[], at: number, fallback: number): number {
  const prev = rest[at - 1];
  const next = rest[at];
  return prev && next ? (prev.order + next.order) / 2 : prev ? prev.order + 1 : next ? next.order - 1 : fallback;
}

/** 中にステップが 1 つも無い枠の、置き場所（order）。図の並びの中で、ステップと同じ物差しで数える */
function emptyFrameOrders(model: FlowModel, steps: Step[]): number[] {
  const filled = new Set(steps.map((s) => s.branchId));
  const groups = new Map<string, Branch[]>();
  for (const b of model.branches) groups.set(b.groupId, [...(groups.get(b.groupId) ?? []), b]);
  return [...groups.values()]
    .filter((arms) => arms.every((b) => !filled.has(b.id)))
    .flatMap((arms) => arms.flatMap((b) => (b.order !== undefined ? [b.order] : [])));
}

/** o より後ろで、いちばん近い位置（ステップか、空の枠）。無ければ undefined */
function nextOrderAfter(model: FlowModel, steps: Step[], o: number): number | undefined {
  const later = [...steps.map((s) => s.order), ...emptyFrameOrders(model, steps)].filter((x) => x > o);
  return later.length > 0 ? Math.min(...later) : undefined;
}

/** o より前で、いちばん近い位置（ステップか、空の枠）。無ければ undefined */
function prevOrderBefore(model: FlowModel, steps: Step[], o: number): number | undefined {
  const earlier = [...steps.map((s) => s.order), ...emptyFrameOrders(model, steps)].filter((x) => x < o);
  return earlier.length > 0 ? Math.max(...earlier) : undefined;
}

/** a と b の間（b が無ければ a の 1 つ後ろ） */
const between = (a: number, b: number | undefined) => (b === undefined ? a + 1 : (a + b) / 2);

/** o の直後で、次のステップ・空の枠とのあいだの位置 */
export function orderJustAfter(model: FlowModel, o: number): number {
  const steps = visibleSteps(model);
  return between(o, nextOrderAfter(model, steps, o));
}

/** 図のいちばん最後の位置（空の枠も含めて数える） */
export function endOrder(model: FlowModel): number {
  const steps = visibleSteps(model);
  return Math.max(0, ...steps.map((s) => s.order), ...emptyFrameOrders(model, steps)) + 1;
}

/**
 * afterStepId のステップの直後の位置。そのステップが枠の中なら、枠の直後（枠の中に枠は作れないため）。
 * afterStepId が無い・見つからないときは図の最後。
 */
export function orderAfterStep(model: FlowModel, afterStepId: StepId | null | undefined): number {
  const steps = visibleSteps(model);
  const at = afterStepId ? steps.find((s) => s.id === afterStepId) : undefined;
  if (!at) return endOrder(model);
  const groupOf = new Map(model.branches.map((b) => [b.id, b.groupId]));
  const group = at.branchId ? groupOf.get(at.branchId) : undefined;
  const last = group ? steps.findLast((s) => s.branchId !== null && groupOf.get(s.branchId) === group)! : at;
  return between(last.order, nextOrderAfter(model, steps, last.order));
}

/**
 * 場合（branchId）の最後にステップを足すときの order。場合が空なら、同じ枠の前の場合の後ろ
 * （無ければ後ろの場合の手前、枠がまるごと空なら枠の位置）。
 */
export function orderInArm(model: FlowModel, branchId: string): number | undefined {
  const branch = model.branches.find((b) => b.id === branchId);
  if (!branch) return undefined;
  const steps = visibleSteps(model);
  const own = steps.findLast((s) => s.branchId === branchId);
  if (own) return between(own.order, nextOrderAfter(model, steps, own.order));
  const arms = groupArms(model, branch.groupId);
  const i = arms.findIndex((b) => b.id === branchId);
  for (const b of arms.slice(0, i).reverse()) {
    const last = steps.findLast((s) => s.branchId === b.id);
    if (last) return between(last.order, nextOrderAfter(model, steps, last.order));
  }
  for (const b of arms.slice(i + 1)) {
    const first = steps.find((s) => s.branchId === b.id);
    if (first) {
      const prev = prevOrderBefore(model, steps, first.order);
      return prev === undefined ? first.order - 1 : (prev + first.order) / 2;
    }
  }
  return arms.find((b) => b.order !== undefined)?.order;
}

/**
 * 空の枠を新しく作る（「＋ 分岐を追加」）。conditions の数だけ場合を作る（場合分け以外は 1 つ）。
 * 置き場所は afterStepId の直後（無ければ図の最後）。中のステップは、あとから場合ごとに足す。
 * 作った場合の id を、上から順に返す。
 */
export function addFrameOps(
  model: FlowModel,
  kind: Branch["kind"],
  conditions: string[],
  afterStepId: StepId | null,
): { ops: ModelOp[]; armIds: string[] } {
  const texts = conditions.map((c) => c.replace(/\s+/g, " ").trim()).filter((c) => c !== "");
  const used = kind === "alt" ? texts : texts.slice(0, 1);
  if (used.length === 0) return { ops: [], armIds: [] };
  const order = orderAfterStep(model, afterStepId);
  const groupId = nextId("G", model.branches.map((b) => b.groupId));
  const ids = model.branches.map((b) => b.id);
  const arms: Branch[] = used.map((condition, index) => {
    const id = nextId("B", ids);
    ids.push(id);
    return { id, kind, condition, groupId, index, order };
  });
  return { ops: arms.map((branch) => ({ op: "branch.add", branch })), armIds: arms.map((b) => b.id) };
}

/** 場合分けに、空の場合を 1 つ足す（「そうでなければ」）。いちばん下に入る。 */
export function addEmptyArmOps(model: FlowModel, groupId: string, condition: string): ModelOp[] {
  const arms = groupArms(model, groupId);
  const text = condition.replace(/\s+/g, " ").trim();
  if (arms.length === 0 || arms[0].kind !== "alt" || text === "") return [];
  const order = arms.find((b) => b.order !== undefined)?.order;
  const branch: Branch = {
    id: nextId("B", model.branches.map((b) => b.id)),
    kind: "alt",
    condition: text,
    groupId,
    index: Math.max(...arms.map((b) => b.index)) + 1,
    ...(order !== undefined ? { order } : {}),
  };
  return [{ op: "branch.add", branch }];
}

/**
 * ステップを枠の外に出す。枠の先頭か末尾ならその場で外し、途中なら枠の直後へ動かす
 * （途中で外すと、枠が 2 つに割れるため）。
 */
export function leaveBranchOps(model: FlowModel, stepId: StepId): ModelOp[] {
  const steps = visibleSteps(model);
  const step = steps.find((s) => s.id === stepId);
  const branch = step?.branchId ? model.branches.find((b) => b.id === step.branchId) : undefined;
  if (!step || !branch) return [];
  const groupOf = new Map(model.branches.map((b) => [b.id, b.groupId]));
  const inGroup = (s: Step) => s.branchId !== null && groupOf.get(s.branchId) === branch.groupId;
  const first = steps.findIndex(inGroup);
  const last = steps.findLastIndex(inGroup);
  const i = steps.indexOf(step);
  const patch: Extract<ModelOp, { op: "step.update" }>["patch"] = { branchId: null };
  if (i !== first && i !== last) {
    const rest = steps.filter((s) => s.id !== stepId);
    patch.order = orderAt(rest, last, step.order); // last は step を抜くと 1 つ前にずれる＝枠の直後
  }
  // 場合が空になっても枠は残す（空になった位置は reducer が覚える）
  return [{ op: "step.update", id: stepId, patch }];
}

/**
 * 作ってあるステップを、場合（branchId）に入れる。ほかの枠・場合からの移し替えもこれ。
 * - 枠にほかのステップがあれば、その場合の最後へ動かす（枠の中身が連続したままになるように）
 * - 枠がまるごと空なら、place で決める
 *   - "step"（編集パネルから）: ステップは動かさず、枠のほうがステップの位置に来る。先に枠を作って、
 *     あとから既存のステップを入れるときに、手順が枠を作った場所（図の最後など）へ飛んでいかないように。
 *     ただしステップが別の枠の中にいるなら、その枠の直後に出す（途中に残すと、元の枠が 2 つに割れるため）
 *   - "frame"（図の上で枠へドラッグ）: 落とした場所に入れたいので、ステップのほうを枠の位置へ動かす
 */
export function enterBranchOps(
  model: FlowModel,
  stepId: StepId,
  branchId: string,
  place: "step" | "frame" = "step",
): ModelOp[] {
  const step = visibleSteps(model).find((s) => s.id === stepId);
  const branch = model.branches.find((b) => b.id === branchId);
  if (!step || !branch || step.branchId === branchId) return [];
  const rest: FlowModel = { ...model, steps: model.steps.filter((s) => s.id !== stepId) };
  const arms = groupArms(model, branch.groupId);
  const frameEmpty = !visibleSteps(rest).some((s) => arms.some((b) => b.id === s.branchId));
  const fromGroup = step.branchId ? model.branches.find((b) => b.id === step.branchId)?.groupId : undefined;
  const order =
    !frameEmpty || place === "frame"
      ? orderInArm(rest, branchId)
      : fromGroup !== undefined && fromGroup !== branch.groupId
        ? orderAfterStep(model, stepId)
        : step.order;
  if (order === undefined) return [];
  return [{ op: "step.update", id: stepId, patch: order === step.order ? { branchId } : { branchId, order } }];
}

/** 枠を消す（中のステップは残して、枠の外に出す）。 */
export function removeGroupOps(model: FlowModel, groupId: string): ModelOp[] {
  return groupArms(model, groupId).map((b) => ({ op: "branch.remove", id: b.id }));
}

/** 枠の種類を変える（場合が 2 つ以上あるのは場合分けだけなので、そのときは変えない）。 */
export function setGroupKindOps(model: FlowModel, groupId: string, kind: Branch["kind"]): ModelOp[] {
  const arms = groupArms(model, groupId);
  if (arms.length !== 1 || arms[0].kind === kind) return [];
  return [{ op: "branch.update", id: arms[0].id, patch: { kind } }];
}

/**
 * 枠の条件の書き出し。直前のステップの結果で分かれることが多いので、そのステップ名を主語にする
 * （「［不備なし］」だけだと、図を渡された人には何の不備か分からない）。
 */
export const conditionPrefix = (label: string) => `「${label}」の結果：`;

/** 場合分けに場合を足すときの書き出し。最初の場合が conditionPrefix で始まっていれば、同じものを使う。 */
export function armConditionPrefix(model: FlowModel, groupId: string): string {
  const first = groupArms(model, groupId)[0];
  return first ? (/^「.+」の結果：/.exec(first.condition)?.[0] ?? "") : "";
}

/**
 * 場合分けの場合の順番を入れ替える（dir: -1 = 上へ、1 = 下へ）。隣の場合と index を入れ替え、
 * 中のステップも新しい順番で並べ直す。枠の中で使っていた order の値をそのまま配り直すので、
 * 枠の外のステップは動かない。
 */
export function moveArmOps(model: FlowModel, branchId: string, dir: -1 | 1): ModelOp[] {
  const branch = model.branches.find((b) => b.id === branchId);
  if (!branch) return [];
  const arms = groupArms(model, branch.groupId);
  const i = arms.findIndex((b) => b.id === branchId);
  const other = arms[i + dir];
  if (!other) return [];
  const swapped = arms.map((b) => (b.id === branch.id ? other : b.id === other.id ? branch : b));
  const steps = visibleSteps(model).filter((s) => arms.some((b) => b.id === s.branchId));
  const orders = steps.map((s) => s.order);
  const reordered = swapped.flatMap((b) => steps.filter((s) => s.branchId === b.id));
  const ops: ModelOp[] = [
    { op: "branch.update", id: branch.id, patch: { index: other.index } },
    { op: "branch.update", id: other.id, patch: { index: branch.index } },
  ];
  reordered.forEach((s, k) => {
    if (s.order !== orders[k]) ops.push({ op: "step.update", id: s.id, patch: { order: orders[k] } });
  });
  return ops;
}
