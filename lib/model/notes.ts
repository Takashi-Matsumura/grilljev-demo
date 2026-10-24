import { visibleSteps } from "../render/mermaid";
import type { FlowModel, IssueKind, ModelOp, OpenIssue, StepId } from "./types";

/**
 * ステップに貼る付箋（チームで決めること・決まったこと）。純関数。
 *
 * 付箋は論点（OpenIssue）そのもの。ステップに結び付いた論点を、図を直す画面では「付箋」として見せる。
 * 新しい入れ物を作らないのは、論点なら会議画面の AI ファシリテーターが未回答のものを拾って問いにし、
 * 業務分掌にも「論点」として出るから（図を直す画面で残した付箋が、次の会議で聞かれる）。
 * 答えが入ると「決まりごと」になり、業務分掌ではそのステップの判断基準として出る。
 */

export const MAX_NOTE_CHARS = 200;

/** 付箋の状態。open = まだ決まっていない（保留も含む）/ answered = 決まった */
export type NoteState = "open" | "answered";

export const noteState = (issue: OpenIssue): NoteState => (issue.status === "answered" ? "answered" : "open");

/** そのステップに貼られた付箋（貼った順） */
export function notesOf(model: FlowModel, stepId: StepId): OpenIssue[] {
  return model.issues.filter((i) => i.relatedStepIds.includes(stepId));
}

/**
 * 図の番号（1 始まり）ごとの付箋の印。まだ決まっていないものが 1 つでもあれば open、すべて決まれば answered。
 * 付箋の無いステップは入れない
 */
export function noteMarks(model: FlowModel): Map<number, NoteState> {
  const marks = new Map<number, NoteState>();
  visibleSteps(model).forEach((s, i) => {
    const notes = notesOf(model, s.id);
    if (notes.length === 0) return;
    marks.set(i + 1, notes.every((n) => noteState(n) === "answered") ? "answered" : "open");
  });
  return marks;
}

/** 次の論点の id（I1, I2, …） */
function nextIssueId(model: FlowModel): string {
  const max = model.issues.reduce((m, i) => Math.max(m, Number(/^I(\d+)$/.exec(i.id)?.[1] ?? 0)), 0);
  return `I${max + 1}`;
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_CHARS);

/** 付箋を貼る op。空の文なら null */
export function addNoteOp(
  model: FlowModel,
  question: string,
  stepIds: StepId[],
  kind: IssueKind = "criteria",
): ModelOp | null {
  const q = clean(question);
  if (q === "" || stepIds.length === 0) return null;
  return {
    op: "issue.add",
    issue: { id: nextIssueId(model), question: q, kind, relatedStepIds: [...new Set(stepIds)], status: "open" },
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
