import type { JevAnswer, JevChoiceAnswer, JevQuestion } from "@/lib/jev";
import type { Actor, FlowModel, ModelOp, Step } from "@/lib/model/types";
import { visibleSteps } from "@/lib/render/mermaid";
import { ASSIGNEE_MIN } from "./thresholds";

/**
 * 会話から担当者（部署の中の個人）を拾う。個人はライフラインにせず、部署のメンバーと
 * ステップの担当者（Step.assignee）として持つ（lib/model/types.ts）。
 *
 * 名前は Jev にも gemma にも作らせない。発話に**そのまま出てくる**ものだけを使う:
 * - 部署のメンバーとして登録済みの名前
 * - 「田中さん」「佐藤様」のように、敬称の付いた名前（敬称は外す）
 */

const NONE = "__none__";

/** 担当者を持てる登場人物（部署・社外）。個人・システムは、それ自体が担当 */
export const canHaveMembers = (a: Actor | undefined): a is Actor =>
  a !== undefined && (a.kind === "role" || a.kind === "external" || a.kind === "unknown");

/** 敬称の付いた名前。漢字・カタカナの 2〜6 文字（「経理の田中さん」→「田中」は、直前の「の」で切れる） */
const HONORIFIC = /([\p{Script=Han}\p{Script=Katakana}ー]{2,6})(?:さん|様|氏)/gu;
/** 敬称が付いても個人名ではない呼び方（「業者さん」「先方さん」） */
const NOT_A_NAME = new Set(["業者", "先方", "社員", "担当", "担当者", "上司", "部下", "先輩", "後輩", "皆様", "運送屋", "銀行", "会社"]);

/**
 * 発話に出てくる個人名。登録済みのメンバーを先に、敬称付きの名前を後に、出てきた順で返す。
 * 個人以外の登場人物の名前（部署・役職）は除く（「部長さん」は役職であって担当者の名前ではない）。
 */
export function personNamesIn(utterance: string, model: FlowModel): string[] {
  // 個人の列（たたむ前の「田中」）は、名前として拾ってよい
  const actorNames = new Set(model.actors.filter((a) => a.kind !== "person").flatMap((a) => [a.name, ...a.aliases]));
  const members = model.actors.flatMap((a) => a.members ?? []);
  const found = members
    .filter((m) => utterance.includes(m))
    .sort((a, b) => utterance.indexOf(a) - utterance.indexOf(b));
  for (const m of utterance.matchAll(HONORIFIC)) {
    // 「経理部田中さん」のように部署名が前に付いていたら外す
    const prefix = [...actorNames].filter((n) => n !== "" && m[1].startsWith(n)).sort((a, b) => b.length - a.length)[0];
    const name = prefix ? m[1].slice(prefix.length) : m[1];
    if (name.length < 2 || NOT_A_NAME.has(name) || actorNames.has(name)) continue;
    if (!found.some((f) => f.includes(name) || name.includes(f))) found.push(name);
  }
  return found;
}

/** その名前をメンバーに持つ登場人物。2 つ以上の部署にいれば決められないので undefined */
export function memberOf(model: FlowModel, name: string): Actor | undefined {
  const owners = model.actors.filter((a) => a.members?.includes(name));
  return owners.length === 1 ? owners[0] : undefined;
}

/** 担当者を入れる ops。メンバーにいない名前なら、送り手の部署のメンバーにも加える */
export function assignOps(model: FlowModel, step: Pick<Step, "id" | "from">, name: string): ModelOp[] {
  const sender = model.actors.find((a) => a.id === step.from);
  if (!canHaveMembers(sender)) return [];
  const ops: ModelOp[] = [{ op: "step.update", id: step.id, patch: { assignee: name } }];
  const members = sender.members ?? [];
  if (!members.includes(name)) {
    ops.push({ op: "actor.update", id: sender.id, patch: { members: [...members, name] } });
  }
  return ops;
}

/**
 * 新しく足すステップの担当者。送り手の部署のメンバーが発話に 1 人だけ出てくれば、その人
 * （「経理部の田中さんが入力します」で、Jev が送り手に経理部を選んだとき）。
 */
export function assigneeForNewStep(model: FlowModel, fromId: string, utterance: string): string | undefined {
  const sender = model.actors.find((a) => a.id === fromId);
  if (!canHaveMembers(sender)) return undefined;
  const names = personNamesIn(utterance, model).filter((n) => sender.members?.includes(n));
  return names.length === 1 ? names[0] : undefined;
}

/** 「どのステップの担当を言っているか」。ステップが無ければ聞かない */
export function buildAssigneeQuestions(model: FlowModel): Record<string, JevQuestion> {
  const steps = visibleSteps(model).filter((s) => canHaveMembers(model.actors.find((a) => a.id === s.from)));
  if (steps.length === 0) return {};
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const all = visibleSteps(model);
  return {
    assignee_step: {
      type: "choice",
      instructions:
        "この発話は、すでに図に描かれている次のステップのどれかを、部署の中の具体的に誰（個人名）がやっているかを述べているか。図のステップには上から 1, 2, 3… と番号が振ってある",
      criteria: {
        ...Object.fromEntries(
          steps.map((s) => [s.id, `${all.indexOf(s) + 1}番: ${nameOf(s.from)} → ${nameOf(s.to)}: ${s.label}`]),
        ),
        [NONE]: "どのステップの担当者の話でもない（個人名が出てこない、新しい手順の説明、部署の話だけ など）",
      },
    },
  };
}

const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `${n}番`);

/**
 * 既存のステップの担当者を述べた発話 → 担当者を入れる ops。
 * ステップは Jev が番号つきの選択肢から選び、名前は発話にそのまま出てくる個人名が 1 人のときだけ使う。
 */
export function interpretAssignee(
  answers: Record<string, JevAnswer | undefined>,
  model: FlowModel,
  utterance: string,
): { ops: ModelOp[]; note: string } | null {
  const a = answers.assignee_step;
  const c = a && a.type === "choice" ? (a as JevChoiceAnswer) : null;
  if (!c || c.choice === NONE || c.confidence < ASSIGNEE_MIN) return null;
  const steps = visibleSteps(model);
  const step = steps.find((s) => s.id === c.choice);
  if (!step) return null;
  const names = personNamesIn(utterance, model);
  if (names.length !== 1 || step.assignee === names[0]) return null;
  const ops = assignOps(model, step, names[0]);
  if (ops.length === 0) return null;
  return { ops, note: `${circled(steps.indexOf(step) + 1)}「${step.label}」の担当者を「${names[0]}」にしました` };
}

/**
 * 所属を尋ねた問い（Issue.foldActorId）への答え → その人を部署にたたむ op。
 * 答えの中に、たたみ先になれる登場人物（部署・社外）の名前か別名が 1 つだけ出てくるときだけ。
 */
export function foldByAnswer(model: FlowModel, foldActorId: string, utterance: string): ModelOp | null {
  const person = model.actors.find((a) => a.id === foldActorId);
  if (!person) return null;
  const targets = model.actors.filter(
    (a) =>
      a.id !== person.id &&
      (a.kind === "role" || a.kind === "external") &&
      [a.name, ...a.aliases].some((n) => n !== "" && utterance.includes(n)),
  );
  return targets.length === 1 ? { op: "actor.fold", from: person.id, into: targets[0].id } : null;
}
