import { drawnFrames, hiddenByFold, visibleSteps } from "../render/mermaid";
import type { ActorId, FlowModel, IssueKind, ModelOp, OpenIssue, StepId } from "./types";

/**
 * 図に貼る付箋（チームで決めること・決まったこと）。純関数。
 *
 * 付箋は論点（OpenIssue）そのもの。手順・枠・登場人物に結び付いた論点を、図を直す画面では「付箋」として見せる。
 * 新しい入れ物を作らないのは、論点なら会議画面の AI ファシリテーターが未回答のものを拾って問いにし、
 * 業務分掌にも「論点」として出るから（図を直す画面で残した付箋が、次の会議で聞かれる）。
 * 答えが入ると「決まりごと」になり、業務分掌ではその手順・枠・登場人物の決まりごととして出る。
 */

export const MAX_NOTE_CHARS = 200;

/** 付箋を貼る先。枠は Branch.groupId（場合ごとではなく枠全体） */
export type NoteTarget = { kind: "step"; id: StepId } | { kind: "frame"; id: string } | { kind: "actor"; id: ActorId };

/** 付箋の状態。open = まだ決まっていない（保留も含む）/ answered = 決まった */
export type NoteState = "open" | "answered";

export const noteState = (issue: OpenIssue): NoteState => (issue.status === "answered" ? "answered" : "open");

const idsOf = (issue: OpenIssue, kind: NoteTarget["kind"]): string[] =>
  kind === "step" ? issue.relatedStepIds : kind === "frame" ? (issue.relatedFrameIds ?? []) : (issue.relatedActorIds ?? []);

/** その手順・枠・登場人物に貼られた付箋（貼った順） */
export function notesOn(model: FlowModel, target: NoteTarget): OpenIssue[] {
  return model.issues.filter((i) => idsOf(i, target.kind).includes(target.id));
}

/** そのステップに貼られた付箋 */
export const notesOf = (model: FlowModel, stepId: StepId) => notesOn(model, { kind: "step", id: stepId });

/** 付箋の束の印。まだ決まっていないものが 1 つでもあれば open、すべて決まれば answered。無ければ undefined */
function stateOf(notes: OpenIssue[]): NoteState | undefined {
  if (notes.length === 0) return undefined;
  return notes.every((n) => noteState(n) === "answered") ? "answered" : "open";
}

/**
 * 図に出す付箋の印。手順は図の番号（1 始まり）、枠は図に描いた枠の順（0 始まり。drawnFrames）、登場人物は id。
 * folds は畳んだ枠の「▸ …」の注記の順（0 始まり。collapsedFrames）: 隠した手順の付箋と、
 * 注記 1 つに畳んだ枠ならその枠の付箋（畳むと、それらの印が図から消えて気づけなくなるため）
 */
export type NoteMarks = {
  steps: ReadonlyMap<number, NoteState>;
  frames: ReadonlyMap<number, NoteState>;
  actors: ReadonlyMap<ActorId, NoteState>;
  folds: ReadonlyMap<number, NoteState>;
};

export function noteMarks(model: FlowModel, collapsed?: ReadonlySet<string>): NoteMarks {
  const steps = new Map<number, NoteState>();
  visibleSteps(model).forEach((s, i) => {
    const st = stateOf(notesOf(model, s.id));
    if (st) steps.set(i + 1, st);
  });
  const frames = new Map<number, NoteState>();
  drawnFrames(model, collapsed).forEach((arms, i) => {
    const st = stateOf(notesOn(model, { kind: "frame", id: arms[0].groupId }));
    if (st) frames.set(i, st);
  });
  const actors = new Map<ActorId, NoteState>();
  for (const a of model.actors) {
    const st = stateOf(notesOn(model, { kind: "actor", id: a.id }));
    if (st) actors.set(a.id, st);
  }
  const folds = new Map<number, NoteState>();
  if (collapsed) {
    hiddenByFold(model, collapsed).forEach(({ groupId, folded, stepIds }, k) => {
      const notes = [
        ...new Set([
          ...(folded ? notesOn(model, { kind: "frame", id: groupId }) : []),
          ...stepIds.flatMap((id) => notesOf(model, id)),
        ]),
      ];
      const st = stateOf(notes);
      if (st) folds.set(k, st);
    });
  }
  return { steps, frames, actors, folds };
}

/** 次の論点の id（I1, I2, …） */
export function nextIssueId(model: FlowModel): string {
  const max = model.issues.reduce((m, i) => Math.max(m, Number(/^I(\d+)$/.exec(i.id)?.[1] ?? 0)), 0);
  return `I${max + 1}`;
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);

/** 付箋を貼る op。手順は複数に貼れる（点検の指摘など）。空の文・貼る先が無ければ null */
export function addNoteOp(
  model: FlowModel,
  question: string,
  on: NoteTarget | { kind: "step"; ids: StepId[] },
  kind: IssueKind = "criteria",
): ModelOp | null {
  const q = clean(question);
  const ids = "ids" in on ? [...new Set(on.ids)] : [on.id];
  if (q === "" || ids.length === 0) return null;
  return {
    op: "issue.add",
    issue: {
      id: nextIssueId(model),
      question: q,
      kind,
      relatedStepIds: on.kind === "step" ? ids : [],
      ...(on.kind === "frame" ? { relatedFrameIds: ids } : {}),
      ...(on.kind === "actor" ? { relatedActorIds: ids } : {}),
      status: "open",
    },
  };
}

/** 付箋の答え（決まったこと）を書く op。空にすると、まだ決まっていない付箋に戻す。変わらなければ null */
export function answerNoteOp(issue: OpenIssue, answer: string): ModelOp | null {
  const a = clean(answer);
  if (a === (issue.answer ?? "")) return null;
  return { op: "issue.update", id: issue.id, patch: { answer: a === "" ? null : a } };
}

/** 同じ文の付箋が、もう貼られているか（点検から付箋にするとき、重ねて貼らない） */
export function findNote(model: FlowModel, question: string): OpenIssue | undefined {
  const q = clean(question);
  return model.issues.find((i) => clean(i.question) === q);
}

/**
 * 書きためた付箋の ops を、最新のモデルに当てられるようにする（登場人物のダイアログは、保存するまで当てない）。
 * 書いている間にほかで論点が増えていたら、足す付箋の id を振り直し、その付箋への手直し（update / remove）も揃える
 */
export function rebaseNoteOps(model: FlowModel, ops: ModelOp[]): ModelOp[] {
  const used = new Set(model.issues.map((i) => i.id));
  const rename = new Map<string, string>();
  let seq = Number(/^I(\d+)$/.exec(nextIssueId(model))?.[1] ?? 1);
  return ops.map((op) => {
    if (op.op === "issue.add") {
      if (!used.has(op.issue.id)) {
        used.add(op.issue.id);
        return op;
      }
      while (used.has(`I${seq}`)) seq += 1;
      const id = `I${seq}`;
      used.add(id);
      rename.set(op.issue.id, id);
      return { ...op, issue: { ...op.issue, id } };
    }
    if ((op.op === "issue.update" || op.op === "issue.remove") && rename.has(op.id)) {
      return { ...op, id: rename.get(op.id)! };
    }
    return op;
  });
}

/**
 * 付箋を、貼った先の言い方と組にする。複数の手順に貼った付箋は 1 行にまとめ、番号を並べる（「手順 5・6「…」／「…」」）。
 * 並びは手順（図の順）→ 枠（図の順）→ 登場人物（左から）。図から消えた先にだけ貼られた付箋は出さない（「6. 論点」には出る）
 */
export function notedTargets(model: FlowModel): { note: OpenIssue; where: string }[] {
  const steps = visibleSteps(model);
  const frames = [...new Set(model.branches.map((b) => b.groupId))];
  const actors = [...model.actors].sort((a, b) => a.lane - b.lane);
  const where = (n: OpenIssue): { rank: number; text: string } | null => {
    const at = steps.flatMap((s, i) => (n.relatedStepIds.includes(s.id) ? [{ no: i + 1, label: s.label }] : []));
    if (at.length > 0) {
      return { rank: at[0].no, text: `手順 ${at.map((x) => x.no).join("・")}「${at.map((x) => x.label).join("」「")}」` };
    }
    const g = frames.find((id) => n.relatedFrameIds?.includes(id));
    if (g) {
      const arms = model.branches.filter((b) => b.groupId === g).sort((a, b) => a.index - b.index);
      return { rank: 10_000 + frames.indexOf(g), text: `枠 ${arms[0].kind}［${arms.map((b) => b.condition).join("／")}］` };
    }
    const a = actors.find((x) => n.relatedActorIds?.includes(x.id));
    if (a) return { rank: 20_000 + actors.indexOf(a), text: `登場人物 ${a.name}` };
    return null;
  };
  return model.issues
    .flatMap((note) => {
      const w = where(note);
      return w ? [{ note, ...w }] : [];
    })
    .sort((x, y) => x.rank - y.rank)
    .map(({ note, text }) => ({ note, where: text }));
}
