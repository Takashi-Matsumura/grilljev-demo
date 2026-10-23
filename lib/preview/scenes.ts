import type { Branch, FlowModel, Step } from "@/lib/model/types";
import { actorLabel, flowItems } from "@/lib/render/mermaid";

/**
 * フローのプレビュー（app/editor/flow-player.tsx）で流す「場面」を、図のモデルから作る。純関数。
 *
 * 場面は、はじめに → ステップ（分岐の入口・各場合・合流をはさむ）→ おわり の順。
 * キャプションはここでコードから作る（AI が無くても再生できる）。AI の言い回し（lib/preview/narrate.ts）が
 * 届いたら、`key` の一致する場面だけ差し替える。分岐の説明は事実そのものなので差し替えない。
 *
 * 分岐の条件は、入口（と各場合）の場面で一度だけ読み上げる。中のステップでは条件を字幕の上の印に出すだけにし、
 * 文にも声にも繰り返さない（同じ条件を何度も聞かされると、流れを追えなくなる）。
 */

/** 図の上で強調するもの。描いた SVG に印を付けて示す（mermaid-diagram.tsx の markPlay） */
export type PlayMark = {
  /** 図の何番目（1 始まり）のステップか。0 なら無し */
  step: number;
  /** 何番目（0 始まり）の付箋（渡すもの）か。-1 なら無し */
  note: number;
  /** 強調する登場人物（図に出る名前。actorLabel） */
  actors: string[];
  /** 図の上から何番目（0 始まり）の枠か。-1 なら無し */
  frame: number;
  /** 強調する条件の文字。最初の場合は枠の見出し、2 つ目以降は else の見出し（図全体で何番目か） */
  condition: { first: true } | { first: false; index: number } | null;
};

export type SceneKind = "intro" | "branch" | "arm" | "step" | "join" | "outro";

export type Scene = {
  kind: SceneKind;
  /** AI の言い回しに差し替えるときの鍵。ステップは id、ほかは "intro" / "outro"。分岐は差し替えない */
  key?: string;
  /** 小さな見出し（「顧客 → 営業担当」「分岐」など） */
  heading: string;
  caption: string;
  /** 読み上げる文。無ければ caption を読む。字幕は詳しく、声は短く、としたい場面で使う */
  speech?: string;
  /** ステップの場面なら、図のステップ名（AI の言い回しに差し替えたあとも、図との対応が分かるように出す） */
  label?: string;
  /** 分岐の中なら、どの場合か（「請求書の内容に不備あり の場合」） */
  context?: string;
  /** 分岐の中のステップなら、その条件の文字そのもの。AI の文から条件の言い直しを取り除くのに使う */
  condition?: string;
  /** 受け渡すもの（付箋） */
  artifact?: string;
  /** 種別・仮・例外などの小さな印 */
  badges: string[];
  /** ステップの場面なら、図の番号（1 始まり） */
  number?: number;
  mark: PlayMark;
};

/** 再生の途中で AI に言い換えさせた文。鍵は Scene.key */
export type Narration = Record<string, string>;

const NO_MARK: PlayMark = { step: 0, note: -1, actors: [], frame: -1, condition: null };

const KIND_LABEL: Record<Step["kind"], string> = {
  sync: "依頼",
  async: "通知",
  reply: "返答",
  self: "自分の作業",
};

const FRAME_HEADING: Record<Branch["kind"], string> = { alt: "分岐", opt: "条件付き", loop: "くり返し" };

const cond = (b: Branch) => `「${b.condition.trim() || "（条件が未入力）"}」`;

/** 分岐の中のステップに添える文脈（どの場合の手順か） */
export function armContext(b: Branch): string {
  if (b.kind === "loop") return `${cond(b)}の間くり返す`;
  if (b.kind === "opt") return `${cond(b)}のときだけ`;
  return `${cond(b)}の場合`;
}

function branchCaption(arms: Branch[]): string {
  const head = arms[0];
  if (head.kind === "loop") return `${cond(head)}の間、次の手順をくり返します。`;
  if (head.kind === "opt") return `${cond(head)}のときだけ、次の手順を行います。`;
  if (arms.length === 1) return `ここで流れが分かれます。${cond(head)}の場合の手順です。`;
  return `ここで流れが分かれます。${arms.map(cond).join("か、")}かで、この先の手順が変わります。`;
}

/** alt の入口で読み上げる文。条件は続く各場合の場面で読むので、ここでは数だけ言う */
function branchSpeech(arms: Branch[]): string | undefined {
  if (arms[0].kind !== "alt") return undefined;
  return arms.length === 1 ? "ここで流れが分かれます。" : `ここで流れが ${arms.length} 通りに分かれます。`;
}

const JOIN_CAPTION: Record<Branch["kind"], string> = {
  alt: "どの場合も、この後は同じ流れに戻ります。",
  opt: "条件に当てはまらないときも、ここから同じ流れに戻ります。",
  loop: "くり返しを終えたら、次の手順へ進みます。",
};

export function buildScenes(model: FlowModel, title: string): Scene[] {
  const actorById = new Map(model.actors.map((a) => [a.id, a]));
  const nameOf = (id: string) => actorById.get(id)?.name ?? "（不明）";
  const labelOf = (id: string) => {
    const a = actorById.get(id);
    return a ? actorLabel(a) : "";
  };
  const trigger = model.actors.find((a) => a.role === "trigger");
  const end = model.actors.find((a) => a.role === "end");
  const items = flowItems(model);
  const stepCount = items.filter((i) => i.step !== null).length;
  const name = title.trim() || model.scope.title.trim() || "この業務";

  const scenes: Scene[] = [];
  scenes.push({
    kind: "intro",
    key: "intro",
    heading: "はじめに",
    caption:
      `「${name}」の流れを、最初から最後まで順に確認します（手順は全部で ${stepCount} つ）。` +
      (trigger && end ? `起点は${trigger.name}、終点は${end.name}です。` : trigger ? `起点は${trigger.name}です。` : ""),
    badges: [],
    mark: { ...NO_MARK, actors: trigger ? [actorLabel(trigger)] : [] },
  });

  let n = 0;
  let note = -1;
  let frame = -1;
  let elseIndex = -1;
  let openGroup: string | null = null;
  let openKind: Branch["kind"] | null = null;
  let openArm: string | null = null;
  let context: string | undefined;
  let condition: string | undefined;

  items.forEach(({ step, branch }) => {
    const groupId = branch?.groupId ?? null;
    if (groupId !== openGroup) {
      if (openKind) scenes.push({ kind: "join", heading: "合流", caption: JOIN_CAPTION[openKind], badges: [], mark: NO_MARK });
      openGroup = groupId;
      openKind = branch?.kind ?? null;
      openArm = null;
      context = undefined;
      condition = undefined;
      if (branch) {
        frame += 1;
        const arms = model.branches.filter((b) => b.groupId === branch.groupId).sort((a, b) => a.index - b.index);
        const shown = branch.kind === "alt" ? arms : [branch];
        scenes.push({
          kind: "branch",
          heading: FRAME_HEADING[branch.kind],
          caption: branchCaption(shown),
          speech: branchSpeech(shown),
          badges: [],
          mark: { ...NO_MARK, frame, condition: { first: true } },
        });
      }
    }
    if (branch && branch.id !== openArm) {
      const first = openArm === null;
      openArm = branch.id;
      context = armContext(branch);
      condition = branch.condition.trim();
      // else を描くのは alt だけ（mermaid.ts）。opt・loop は入口の場面で条件を言っている
      if (branch.kind === "alt") {
        if (!first) elseIndex += 1;
        scenes.push({
          kind: "arm",
          heading: FRAME_HEADING.alt,
          caption: `${first ? "まず" : "次に"}${cond(branch)}の場合です。`,
          badges: [],
          mark: { ...NO_MARK, frame, condition: first ? { first: true } : { first: false, index: elseIndex } },
        });
      }
    }
    if (step === null) {
      const last = scenes[scenes.length - 1];
      last.caption += "この場合の手順は、まだ書かれていません。";
      if (last.speech) last.speech += "この場合の手順は、まだ書かれていません。";
      return;
    }

    n += 1;
    if (step.artifact) note += 1;
    const badges = [KIND_LABEL[step.kind]];
    if (step.status === "provisional") badges.push("仮");
    if (step.flags.exception) badges.push("例外");
    if (step.flags.tacit) badges.push("暗黙知");
    if (step.flags.personDependent) badges.push("属人");
    if (step.assignee) badges.push(`担当: ${step.assignee}`);
    scenes.push({
      kind: "step",
      key: step.id,
      heading: step.from === step.to ? nameOf(step.from) : `${nameOf(step.from)} → ${nameOf(step.to)}`,
      caption: step.label.trim() || "（ステップ名が未入力）",
      label: step.label.trim(),
      context,
      condition,
      artifact: step.artifact?.trim() || undefined,
      badges,
      number: n,
      mark: {
        ...NO_MARK,
        step: n,
        note: step.artifact ? note : -1,
        actors: [...new Set([labelOf(step.from), labelOf(step.to)])].filter(Boolean),
      },
    });
  });

  scenes.push({
    kind: "outro",
    key: "outro",
    heading: "おわり",
    caption: `以上で「${name}」の流れは終わりです。` + (end ? `最終的な成果は${end.name}が受け取ります。` : ""),
    badges: [],
    mark: { ...NO_MARK, actors: end ? [actorLabel(end)] : [] },
  });
  return scenes;
}

/** 文頭の「〜の場合、」「〜の間は、」のような条件の言い直しとみなす、読点までの長さの上限（条件の文字数に足す） */
const CONDITION_SLACK = 16;

/**
 * 分岐の中のステップの文から、文頭の条件の言い直し（「「メール送信」の場合、」など）を取り除く。
 * 条件は分岐の場面で読み上げ、字幕の上の印にも出ているので、ステップごとに繰り返さない。
 * 読点の前が「場合・とき・間・なら」で終わるときだけ取る（主語の「顧客が営業担当に、」などは残す）。
 * 取ると空になるなら元のまま。
 */
export function dropCondition(sentence: string, condition: string | undefined): string {
  if (condition === undefined) return sentence;
  const comma = sentence.indexOf("、");
  if (comma <= 0 || comma > condition.length + CONDITION_SLACK) return sentence;
  if (!/(場合|とき|時|間|なら)(は|に|には|も)?$/.test(sentence.slice(0, comma))) return sentence;
  const rest = sentence.slice(comma + 1).trim();
  return rest === "" ? sentence : rest;
}

/** AI の言い回しを当てる。届いていない場面は、コードで作ったキャプションのまま */
export function narrate(scenes: Scene[], narration: Narration | null): Scene[] {
  if (!narration) return scenes;
  return scenes.map((s) =>
    s.key && narration[s.key] ? { ...s, caption: dropCondition(narration[s.key], s.condition) } : s,
  );
}

/** 場面で読み上げる文 */
export const speechOf = (s: Scene): string => s.speech ?? s.caption;
