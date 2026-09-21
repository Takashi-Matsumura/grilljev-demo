import type { Actor, FlowModel, ModelOp, Scope } from "./types";

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
          .map((a) => (a.id === into.id ? { ...a, aliases } : a)),
        steps: m.steps.map((s) => ({
          ...s,
          from: s.from === from.id ? into.id : s.from,
          to: s.to === from.id ? into.id : s.to,
        })),
      };
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
      if (!m.steps.some((s) => s.id === op.id)) return null;
      return {
        ...m,
        steps: m.steps.map((s) => (s.id === op.id ? { ...s, ...op.patch } : s)),
      };
    }

    case "step.retract": {
      if (!m.steps.some((s) => s.id === op.id)) return null;
      return {
        ...m,
        steps: m.steps.map((s) => (s.id === op.id ? { ...s, status: "retracted" } : s)),
      };
    }

    case "branch.add": {
      if (m.branches.some((b) => b.id === op.branch.id)) return null;
      return { ...m, branches: [...m.branches, op.branch] };
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

/** 初期設定（業務名 + 関係部署）から開始時のモデルを作る。部署は role のアクターになる。 */
export function modelFromScope(title: string, departments: string[], at: string): FlowModel {
  const names = departments.map((d) => d.trim()).filter((d) => d !== "");
  const actors: Actor[] = names.map((name, i) => ({
    id: `A${i + 1}`,
    name,
    kind: "role",
    aliases: [],
    lane: i,
    addedAtRev: 0,
  }));
  return { ...emptyModel({ title }, at), actors };
}

/** 末尾に足すときの order。中間に挿すときは前後の中点を自分で計算すること。 */
export function nextOrder(model: FlowModel): number {
  return model.steps.reduce((max, s) => Math.max(max, s.order), 0) + 1;
}
