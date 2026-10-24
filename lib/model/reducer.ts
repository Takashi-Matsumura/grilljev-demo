import type { SessionSeed } from "../store/session-types";
import type { Actor, FlowModel, ModelOp, OpenIssue, Scope, Step } from "./types";

/**
 * 質問（issue.ask）したあと、答えないまま業務の発話が続いたら、この回数で保留にする。
 * 「答えが出なければ保留として明記し、次に進む」= 同じ問いで会議が滞留しないための歯止め。
 */
export const SKIP_LIMIT = 2;

/**
 * FlowModel を変更する唯一の入口。純関数（時刻は `at` で受け取る）。
 *
 * **不正な op は例外にせず無視する**（存在しないアクターへのステップ、重複 id など）。
 * ライブ会議で 1 発話の判定ミスが全体を止めるより、その 1 op だけ落ちる方がよい。
 * 何か 1 つでも適用されたときだけ rev を 1 上げる。
 */
export function applyOps(model: FlowModel, ops: ModelOp[], at: string): FlowModel {
  const rev = model.rev + 1;
  let m = model;

  for (const op of ops) {
    const next = applyOne(m, op, rev);
    if (next) m = next;
  }
  return m === model ? model : { ...m, rev, updatedAt: at };
}

function applyOne(m: FlowModel, op: ModelOp, rev: number): FlowModel | null {
  switch (op.op) {
    case "scope.set":
      return { ...m, scope: { ...m.scope, ...op.patch } };

    case "actor.add": {
      if (m.actors.some((a) => a.id === op.actor.id)) return null;
      const lane = m.actors.reduce((max, a) => Math.max(max, a.lane), -1) + 1;
      return { ...m, actors: [...m.actors, { ...op.actor, lane, addedAtRev: rev }] };
    }

    case "actor.merge": {
      if (op.from === op.into) return null;
      const from = m.actors.find((a) => a.id === op.from);
      const into = m.actors.find((a) => a.id === op.into);
      if (!from || !into) return null;
      const aliases = [...new Set([...into.aliases, from.name, ...from.aliases])].filter(
        (name) => name !== into.name,
      );
      return {
        ...m,
        actors: m.actors
          .filter((a) => a.id !== from.id)
          .map((a) =>
            a.id === into.id
              ? {
                  ...a,
                  aliases,
                  role: a.role ?? from.role,
                  focus: a.focus ?? from.focus,
                  present: a.present ?? from.present,
                  product: a.product ?? from.product,
                  note: a.note ?? from.note,
                  ...(into.members || from.members
                    ? { members: [...new Set([...(into.members ?? []), ...(from.members ?? [])])] }
                    : {}),
                }
              : a,
          ),
        steps: m.steps.map((s) => ({
          ...s,
          from: s.from === from.id ? into.id : s.from,
          to: s.to === from.id ? into.id : s.to,
        })),
      };
    }

    case "actor.fold": {
      if (op.from === op.into) return null;
      const from = m.actors.find((a) => a.id === op.from);
      const into = m.actors.find((a) => a.id === op.into);
      if (!from || !into) return null;
      const members = [...new Set([...(into.members ?? []), from.name])];
      return {
        ...m,
        actors: m.actors
          .filter((a) => a.id !== from.id)
          .map((a) => (a.id === into.id ? { ...a, members, role: a.role ?? from.role } : a)),
        steps: m.steps.map((s) => {
          if (s.from !== from.id && s.to !== from.id) return s;
          const next: Step = {
            ...s,
            from: s.from === from.id ? into.id : s.from,
            to: s.to === from.id ? into.id : s.to,
          };
          if (s.from === from.id) next.assignee = from.name;
          // 「経理部 → 田中」は、たたむと経理部の中で完結する作業になる
          if (next.from === next.to) next.kind = "self";
          return next;
        }),
      };
    }

    case "actor.remove": {
      if (!m.actors.some((a) => a.id === op.id)) return null;
      const linked = (s: Step) => s.from === op.id || s.to === op.id;
      if (m.steps.some((s) => linked(s) && s.status !== "retracted")) return null;
      return {
        ...m,
        actors: m.actors.filter((a) => a.id !== op.id),
        steps: m.steps.filter((s) => !linked(s)),
        // 消したステップを指す論点の関連は外す（論点そのものは残す）
        issues: m.issues.map((i) =>
          i.relatedStepIds.some((id) => m.steps.some((s) => s.id === id && linked(s)))
            ? { ...i, relatedStepIds: i.relatedStepIds.filter((id) => !m.steps.some((s) => s.id === id && linked(s))) }
            : i,
        ),
      };
    }

    case "actor.update": {
      const target = m.actors.find((a) => a.id === op.id);
      if (!target) return null;
      const { name: rawName, role, focus, present, product, note, aliases, ...rest } = op.patch;
      const name = rawName?.replace(/\s+/g, " ").trim();
      // 空の名前・他の人と同じ名前への改名は無視する（名前で人を見分けているため）
      const renamed =
        name !== undefined && name !== "" && name !== target.name && !m.actors.some((a) => a.name === name);
      const next: Actor = { ...target, ...rest };
      if (renamed) next.name = name;
      // 改名した元の名前は別名に残す。別名に自分の名前は入れない
      const base = aliases ?? target.aliases;
      next.aliases = [...new Set(renamed ? [...base, target.name] : base)].filter((n) => n !== next.name);
      const optional = { present, product, note } as const;
      for (const key of ["present", "product", "note"] as const) {
        const v = optional[key];
        if (v === null || v === "") delete next[key];
        else if (v !== undefined) (next as Record<typeof key, unknown>)[key] = v;
      }
      if (role === null) delete next.role;
      else if (role !== undefined) next.role = role;
      if (focus === null) delete next.focus;
      else if (focus) next.focus = true;
      return {
        ...m,
        actors: m.actors.map((a) => {
          if (a.id === target.id) return next;
          // 起点・終点・中心はそれぞれ 1 人だけ。付け替えたら前の人からは外す
          const without = { ...a };
          if (role && a.role === role) delete without.role;
          if (focus && a.focus) delete without.focus;
          return without.role === a.role && without.focus === a.focus ? a : without;
        }),
      };
    }

    case "actor.reorder": {
      const byLane = [...m.actors].sort((a, b) => a.lane - b.lane);
      const known = new Set(byLane.map((a) => a.id));
      const head = [...new Set(op.ids)].filter((id) => known.has(id));
      const order = [...head, ...byLane.map((a) => a.id).filter((id) => !head.includes(id))];
      const laneOf = new Map(order.map((id, i) => [id, i]));
      return { ...m, actors: m.actors.map((a) => ({ ...a, lane: laneOf.get(a.id) ?? a.lane })) };
    }

    case "step.add": {
      const s = op.step;
      if (m.steps.some((x) => x.id === s.id)) return null;
      if (!m.actors.some((a) => a.id === s.from) || !m.actors.some((a) => a.id === s.to)) {
        return null;
      }
      if (s.branchId !== null && !m.branches.some((b) => b.id === s.branchId)) return null;
      return { ...m, steps: [...m.steps, { ...s, addedAtRev: rev }] };
    }

    case "step.update": {
      const target = m.steps.find((s) => s.id === op.id);
      if (!target) return null;
      const next = { ...m, steps: m.steps.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)) };
      return target.branchId !== null && next.steps.find((s) => s.id === op.id)?.branchId !== target.branchId
        ? keepEmptyArm(next, target.branchId, target.order)
        : next;
    }

    case "step.retract": {
      const target = m.steps.find((s) => s.id === op.id);
      if (!target || target.status === "retracted") return null;
      const retractedFrom = target.status;
      const next = {
        ...m,
        steps: m.steps.map((s): Step => (s.id === op.id ? { ...s, status: "retracted", retractedFrom } : s)),
      };
      return target.branchId !== null ? keepEmptyArm(next, target.branchId, target.order) : next;
    }

    case "step.restore": {
      const target = m.steps.find((s) => s.id === op.id);
      if (!target || target.status !== "retracted") return null;
      // 取り消す前の状態が分からない（この仕組みより前に取り消した）ものは、仮として戻す
      const restored: Step = { ...target, status: target.retractedFrom ?? "provisional" };
      delete restored.retractedFrom;
      return { ...m, steps: m.steps.map((s) => (s.id === op.id ? restored : s)) };
    }

    case "branch.add": {
      if (m.branches.some((b) => b.id === op.branch.id)) return null;
      return { ...m, branches: [...m.branches, op.branch] };
    }

    case "branch.update": {
      if (!m.branches.some((b) => b.id === op.id)) return null;
      const condition = op.patch.condition?.replace(/\s+/g, " ").trim();
      if (condition === "") return null;
      return {
        ...m,
        branches: m.branches.map((b) =>
          b.id === op.id
            ? {
                ...b,
                ...(condition !== undefined ? { condition } : {}),
                ...(op.patch.kind ? { kind: op.patch.kind } : {}),
                ...(op.patch.index !== undefined ? { index: op.patch.index } : {}),
              }
            : b,
        ),
      };
    }

    case "branch.remove": {
      if (!m.branches.some((b) => b.id === op.id)) return null;
      return {
        ...m,
        branches: m.branches.filter((b) => b.id !== op.id),
        // 取り消したステップも外す（元に戻したときに、無い枠を指さないように）
        steps: m.steps.map((s) => (s.branchId === op.id ? { ...s, branchId: null } : s)),
      };
    }

    case "issue.add": {
      if (m.issues.some((i) => i.id === op.issue.id)) return null;
      return { ...m, issues: [...m.issues, { ...op.issue, raisedAtRev: rev }] };
    }

    case "issue.ask": {
      const target = m.issues.find((i) => i.id === op.id);
      // 答え済み・保留済みの論点は蒸し返さない
      if (!target || target.status === "answered" || target.status === "parked") return null;
      return {
        ...m,
        issues: m.issues.map((i) =>
          i.id === op.id ? { ...i, status: "asked", prompt: op.prompt, ignored: 0 } : i,
        ),
      };
    }

    case "issue.skip": {
      const target = m.issues.find((i) => i.id === op.id);
      if (!target || target.status !== "asked") return null;
      const ignored = (target.ignored ?? 0) + 1;
      return {
        ...m,
        issues: m.issues.map((i) =>
          i.id === op.id
            ? { ...i, ignored, status: ignored >= SKIP_LIMIT ? "parked" : "asked" }
            : i,
        ),
      };
    }

    case "issue.resolve": {
      if (!m.issues.some((i) => i.id === op.id)) return null;
      return {
        ...m,
        issues: m.issues.map((i) =>
          i.id === op.id ? { ...i, status: "answered", answer: op.answer } : i,
        ),
      };
    }

    case "issue.park": {
      if (!m.issues.some((i) => i.id === op.id)) return null;
      return {
        ...m,
        issues: m.issues.map((i) => (i.id === op.id ? { ...i, status: "parked" } : i)),
      };
    }

    case "issue.update": {
      const target = m.issues.find((i) => i.id === op.id);
      if (!target) return null;
      const next: OpenIssue = { ...target };
      const question = op.patch.question?.replace(/\s+/g, " ").trim();
      if (question) next.question = question;
      if (op.patch.answer === null) {
        delete next.answer;
        next.status = "open";
      } else if (op.patch.answer !== undefined && op.patch.answer.trim() !== "") {
        next.answer = op.patch.answer.trim();
        next.status = "answered";
      }
      return { ...m, issues: m.issues.map((i) => (i.id === op.id ? next : i)) };
    }

    case "issue.remove": {
      if (!m.issues.some((i) => i.id === op.id)) return null;
      return { ...m, issues: m.issues.filter((i) => i.id !== op.id) };
    }

    default: {
      const unreachable: never = op;
      return unreachable;
    }
  }
}

export function emptyModel(scope: Partial<Scope>, at: string): FlowModel {
  return {
    rev: 0,
    scope: { title: "", purpose: "", trigger: "", frequency: "", ...scope },
    actors: [],
    steps: [],
    branches: [],
    issues: [],
    updatedAt: at,
  };
}

/** 初期設定（業務名 + 登場人物）から開始時のモデルを作る。登場人物は並べた順にライフラインになる。 */
export function modelFromSeed(seed: SessionSeed, at: string): FlowModel {
  const actors: Actor[] = seed.actors.map((s, i) => ({
    id: `A${i + 1}`,
    name: s.name,
    kind: s.kind,
    aliases: [],
    lane: i,
    addedAtRev: 0,
    ...(s.role ? { role: s.role } : {}),
    ...(s.focus ? { focus: true as const } : {}),
    ...(typeof s.present === "boolean" ? { present: s.present } : {}),
    ...(s.members && s.members.length > 0 ? { members: s.members } : {}),
    ...(s.aliases && s.aliases.length > 0 ? { aliases: s.aliases } : {}),
    ...(s.product ? { product: s.product } : {}),
    ...(s.note ? { note: s.note } : {}),
  }));
  return { ...emptyModel({ title: seed.title }, at), actors };
}

/** 末尾に足すときの order。中間に挿すときは前後の中点を自分で計算すること。 */
export function nextOrder(model: FlowModel): number {
  return model.steps.reduce((max, s) => Math.max(max, s.order), 0) + 1;
}

/**
 * ステップが場合（branchId）から抜けて、その場合に残るステップが無くなったら、抜けたステップの位置を
 * 場合の order として覚えておく（空の枠も、元の位置に描き続けるため）。
 */
function keepEmptyArm(m: FlowModel, branchId: string, order: number): FlowModel {
  if (m.steps.some((s) => s.branchId === branchId && s.status !== "retracted")) return m;
  return { ...m, branches: m.branches.map((b) => (b.id === branchId ? { ...b, order } : b)) };
}
