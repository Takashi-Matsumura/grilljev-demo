/**
 * 業務フローの正規化モデル。図（Mermaid / drawio）も保存 JSON も、すべてここから作る。
 * 型のみで実行時依存を持たない。
 *
 * 変更は `ModelOp`（差分）で表す。「即適用」「ユーザー確認待ち」「取り消し」を
 * 同じ仕組みに乗せるため。ops を適用するのは reducer.ts の `applyOps` だけ。
 */

export type ActorId = string; // "A1" — Mermaid の participant id になるので英数字のみ
export type StepId = string; // "S12"

export type ActorKind = "person" | "role" | "system" | "external" | "unknown";

export type Actor = {
  id: ActorId;
  name: string;
  kind: ActorKind;
  /** 会話中の言い方のゆらぎ（「経理」「経理担当」）。whisper のヒントにも使う */
  aliases: string[];
  /** ライフラインの並び順（左から） */
  lane: number;
  addedAtRev: number;
};

/** sync=依頼して返事を待つ / async=投げっぱなし / reply=返答 / self=自分の中で完結 */
export type MessageKind = "sync" | "async" | "reply" | "self";

export type StepStatus = "confirmed" | "provisional" | "retracted";

/** ops-grill の掘り下げ軸。ステップの脇にバッジで出す */
export type StepFlags = {
  exception?: true;
  tacit?: true;
  personDependent?: true;
};

export type Step = {
  id: StepId;
  from: ActorId;
  to: ActorId;
  label: string;
  kind: MessageKind;
  /** 書類・システムなど。図では付箋になる */
  artifact?: string;
  branchId: string | null;
  /** 実数。「あ、その前に」の中間挿入を整数の振り直し無しで行うため */
  order: number;
  /** 判定の確信度 0..1。低いものは点線で描く */
  confidence: number;
  status: StepStatus;
  flags: StepFlags;
  sourceUtteranceIds: string[];
  addedAtRev: number;
};

export type Branch = {
  id: string;
  kind: "alt" | "opt" | "loop";
  condition: string;
  /** alt の else 側は同じ groupId で index を 1 にする */
  groupId: string;
  index: number;
};

export type IssueKind =
  | "purpose"
  | "who"
  | "when"
  | "criteria"
  | "exception"
  | "tool"
  | "handoff";

export type IssueStatus = "open" | "asked" | "answered" | "parked";

export type OpenIssue = {
  id: string;
  question: string;
  kind: IssueKind;
  relatedStepIds: StepId[];
  /** parked = 「答えが出ないので保留にして進む」（ライブロック防止） */
  status: IssueStatus;
  /** grill-me の規律: 各問に推奨回答を添える */
  prompt?: { text: string; suggestedAnswer: string };
  /** 質問したあと、答えないまま業務の発話が続いた回数。2 回で保留にする */
  ignored?: number;
  answer?: string;
  raisedAtRev: number;
};

/** 対象業務＝参加者の共通認識。会話の中で変わりうる */
export type Scope = {
  title: string;
  /** 存在意義。空のうちは grill の最優先課題になる */
  purpose: string;
  trigger: string;
  frequency: string;
};

export type FlowModel = {
  rev: number;
  scope: Scope;
  actors: Actor[];
  steps: Step[];
  branches: Branch[];
  issues: OpenIssue[];
  updatedAt: string;
};

/** ops で新規追加するときの入力。lane と rev は reducer が採番する */
export type NewActor = Omit<Actor, "lane" | "addedAtRev">;
export type NewStep = Omit<Step, "addedAtRev">;
export type NewIssue = Omit<OpenIssue, "raisedAtRev">;

export type ModelOp =
  | { op: "scope.set"; patch: Partial<Scope> }
  | { op: "actor.add"; actor: NewActor }
  /** 表記ゆれの統合。from のステップを into へ付け替え、from の名前を into の aliases へ足す */
  | { op: "actor.merge"; from: ActorId; into: ActorId }
  | { op: "step.add"; step: NewStep }
  | { op: "step.update"; id: StepId; patch: Partial<Omit<Step, "id" | "addedAtRev">> }
  /** 削除ではなく取り消し。履歴に残す */
  | { op: "step.retract"; id: StepId }
  | { op: "branch.add"; branch: Branch }
  | { op: "issue.add"; issue: NewIssue }
  /** ファシリテーターが問いを出した。文言と推奨回答を持たせ、質問済みにする */
  | { op: "issue.ask"; id: string; prompt: { text: string; suggestedAnswer: string } }
  /** 質問したのに答えないまま話が進んだ。回数を数え、SKIP_LIMIT 回で保留にする */
  | { op: "issue.skip"; id: string }
  | { op: "issue.resolve"; id: string; answer: string }
  | { op: "issue.park"; id: string };
