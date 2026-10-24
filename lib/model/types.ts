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

/** trigger=業務を始める人 / end=最終的な成果を受け取る人。会議の前に決めて、会話の方向を作る */
export type ActorRole = "trigger" | "end";

export type Actor = {
  id: ActorId;
  name: string;
  kind: ActorKind;
  /**
   * 会話中の言い方のゆらぎ（「経理」「経理担当」）と、その会社だけの呼び方（「基幹」「共有フォルダ」）。
   * 会話からこの人を見つける手がかりで、whisper のヒントにも使う。改名した元の名前もここに残る
   */
  aliases: string[];
  /** ライフラインの並び順（左から） */
  lane: number;
  addedAtRev: number;
  role?: ActorRole;
  /**
   * この業務の中心となる登場人物（図で強調する）。全体で 1 人だけ。
   * 誰にも付いていなければ終点の人を中心とみなす（focusActorOf）
   */
  focus?: true;
  /**
   * 会議に出席しているか。false の登場人物の作業は、会話からは推測しかできない（未確認として扱う）。
   * 未設定は undefined。システムは出席しないので見ない（isAbsent）
   */
  present?: boolean;
  /**
   * 具体的な名前。システムなら製品・サービス名（「freee会計」）、社外なら会社名、部署なら正式名称。
   * 図では名前の下に 2 段目で添える（toMermaid・drawio）
   */
  product?: string;
  /** 補足（役割・使い方など）。図には出さず、編集画面と AI の材料にだけ使う */
  note?: string;
  /**
   * 部署の中の人（「田中」「佐藤」）。個人はライフラインにせず、ここに持つ。
   * 列を役割で並べておくと、人が替わっても図が古くならず、同じ役割の仕事が 2 つの列に分かれない
   */
  members?: string[];
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
  /** 受け渡す書類・データ・ファイル。図では付箋（帯）になる。システム・道具は入れない（登場人物かステップ名で表す） */
  artifact?: string;
  /** このステップを実際にやる人（送り手の部署のメンバー）。図では既定で出さない */
  assignee?: string;
  /**
   * この手順の結果に責任を持ち、承認・判断する部署・人（責任分担表の A）。送り手と違う人のことが多い。
   * 図には出さず、業務分掌（部署別の分掌・責任分担表・統制上の確認点）に使う
   */
  approver?: ActorId;
  branchId: string | null;
  /** 実数。「あ、その前に」の中間挿入を整数の振り直し無しで行うため */
  order: number;
  /** 判定の確信度 0..1。低いものは点線で描く */
  confidence: number;
  status: StepStatus;
  flags: StepFlags;
  sourceUtteranceIds: string[];
  addedAtRev: number;
  /** 取り消す前の状態。元に戻すとき（step.restore）に使う */
  retractedFrom?: Exclude<StepStatus, "retracted">;
};

export type Branch = {
  id: string;
  kind: "alt" | "opt" | "loop";
  condition: string;
  /** alt の else 側は同じ groupId で index を 1 にする */
  groupId: string;
  index: number;
  /**
   * 枠の中が空のときの、図の中の位置（ステップの order と同じ物差し）。/editor で先に枠を作ると、
   * 中にステップが無いので、これで描く位置を決める。中にステップがあれば使わない（ステップの位置で決まる）
   */
  order?: number;
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
  /** 付箋（lib/model/notes.ts）を貼った枠（Branch.groupId）。分岐の判定の基準など、枠全体に関わること */
  relatedFrameIds?: string[];
  /** 付箋を貼った登場人物。その人・部署・システムについて決めておくこと */
  relatedActorIds?: ActorId[];
  /** parked = 「答えが出ないので保留にして進む」（ライブロック防止） */
  status: IssueStatus;
  /** grill-me の規律: 各問に推奨回答を添える */
  prompt?: { text: string; suggestedAnswer: string };
  /** 質問したあと、答えないまま業務の発話が続いた回数。2 回で保留にする */
  ignored?: number;
  answer?: string;
  raisedAtRev: number;
  /**
   * 所属を尋ねる問い（「田中さんはどの部署の方ですか？」）のとき、その個人の列の id。
   * 答えに部署の名前が 1 つだけ出てきたら、その部署にたたむ（actor.fold）
   */
  foldActorId?: ActorId;
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
  /** 会議画面での手直し。改名した元の名前は aliases に残す。role は null で外す（起点・終点は各 1 人） */
  | {
      op: "actor.update";
      id: ActorId;
      /** null は「外す（未設定に戻す）」 */
      patch: {
        name?: string;
        kind?: ActorKind;
        role?: ActorRole | null;
        /** true で中心にする（前の人からは外す）。null で外す（終点が中心に戻る） */
        focus?: true | null;
        present?: boolean | null;
        members?: string[];
        aliases?: string[];
        product?: string | null;
        note?: string | null;
      };
    }
  /**
   * 個人の列を部署にたたむ（「田中」→ 経理部のメンバー）。from が送り手のステップは into から出て、
   * 担当者が from の名前になる。from が受け手のステップは into が受ける。from の列は消える
   */
  | { op: "actor.fold"; from: ActorId; into: ActorId }
  /**
   * 登場人物を消す。図に残っているステップがつながっている人は消さない（ステップが宙に浮くため）。
   * 取り消したステップだけがつながっているなら、それらも一緒に消す（元に戻すと宙に浮くため）
   */
  | { op: "actor.remove"; id: ActorId }
  /** ライフラインの並び替え。ids の順に lane を振り直す（ids に無い人は、元の順で後ろに続ける） */
  | { op: "actor.reorder"; ids: ActorId[] }
  | { op: "step.add"; step: NewStep }
  | { op: "step.update"; id: StepId; patch: Partial<Omit<Step, "id" | "addedAtRev">> }
  /** 削除ではなく取り消し。履歴に残す */
  | { op: "step.retract"; id: StepId }
  /** 取り消したステップを元に戻す。状態は取り消す前に戻し、並び順（order）はそのまま */
  | { op: "step.restore"; id: StepId }
  | { op: "branch.add"; branch: Branch }
  /**
   * 分岐の条件・種類・場合の順番（index）を変える。種類は枠全体で揃えること（branch.ts の setGroupKindOps）。
   * index を変えるときは、ステップの並びも合わせること（branch.ts の moveArmOps）
   */
  | { op: "branch.update"; id: string; patch: { condition?: string; kind?: Branch["kind"]; index?: number } }
  /** 分岐（枠の 1 つの場合）を消す。中にあったステップは枠の外に出す（ステップ自体は消さない） */
  | { op: "branch.remove"; id: string }
  | { op: "issue.add"; issue: NewIssue }
  /** ファシリテーターが問いを出した。文言と推奨回答を持たせ、質問済みにする */
  | { op: "issue.ask"; id: string; prompt: { text: string; suggestedAnswer: string } }
  /** 質問したのに答えないまま話が進んだ。回数を数え、SKIP_LIMIT 回で保留にする */
  | { op: "issue.skip"; id: string }
  | { op: "issue.resolve"; id: string; answer: string }
  | { op: "issue.park"; id: string }
  /**
   * 付箋（ステップに結び付いた論点。lib/model/notes.ts）の手直し。answer を書くと決まった（answered）に、
   * null で外すとまだ決まっていない（open）に戻す
   */
  | { op: "issue.update"; id: string; patch: { question?: string; answer?: string | null } }
  /** 付箋を外す（論点ごと消す） */
  | { op: "issue.remove"; id: string };
