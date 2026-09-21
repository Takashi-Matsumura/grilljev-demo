import type {
  JevAnswer,
  JevChoiceAnswer,
  JevNoulAnswer,
  JevScoreAnswer,
} from "@/lib/jev";
import type {
  FlowModel,
  IssueKind,
  MessageKind,
  ModelOp,
  NewIssue,
  StepFlags,
} from "@/lib/model/types";
import {
  ACTOR_APPLY,
  ACTOR_DUP_MIN,
  CHATTER_DROP,
  DUP_CONFIDENT,
  FALLBACK_LABEL_CHARS,
  FAITHFUL_MIN,
  FLAG_MIN,
  INTENT_MIN,
  ISSUE_ANSWERED,
  MAX_LABEL_ATTEMPTS,
  READABLE_MIN,
  SCOPE_CONFIDENT,
  SPECIFICITY_ADD_MIN,
  SPECIFICITY_APPLY,
} from "./thresholds";
import {
  NEW_ACTOR,
  NO_DUP_ACTOR,
  NO_ISSUE,
  NO_STEP,
  UNKNOWN_ACTOR,
  isLiveCheck,
  qActorDup,
  qFaithful,
  qReadable,
} from "./questions";
import { checkKey, type CheckResult, type PendingCheck } from "./verify";

/**
 * jev の回答 → 図の変更。
 *
 * - drop      雑談。図を動かさない
 * - apply     図を変更した（実線）
 * - confirm   確信が足りない。仮ステップとして足したか、足せなかった（理由は summary）
 * - unchanged 業務の話だが、図に足すものが無い
 *
 * 文言（ステップ名・新しい登場人物の名前・分岐の条件文）の生成は gemma の役目。
 * ここではまず暫定の文言（発話の先頭）で図に足し、gemma に回す仕事を `followUps` として返す。
 * gemma が作った文言は、次のリクエストの `checks` で jev が検証する。
 */

export type Verdict = "drop" | "apply" | "confirm" | "unchanged";

/** gemma に回す仕事。クライアントが順番に処理する。 */
export type FollowUp =
  | {
      /** 追加したステップに、ステップ名・書類名・分岐の条件文を付ける */
      kind: "label";
      stepId: string;
      /** jev の branch_marker / artifact_present（0..1）。gemma に考えさせるかの手がかり */
      branchHint: number;
      artifactHint: number;
    }
  | {
      /** 新しい登場人物の名前を特定して、ステップを追加する */
      kind: "actors";
      need: { from: boolean; to: boolean };
      fromId: string | null;
      toId: string | null;
      messageKind: MessageKind;
      confidence: number;
      specificity: number;
      flags: StepFlags;
      branchHint: number;
      artifactHint: number;
    };

export type Interpretation = {
  verdict: Verdict;
  ops: ModelOp[];
  /** 画面に出す 1 行の説明 */
  summary: string;
  /** chatter(noul) の P(true)。雑談らしさ */
  chatter: number;
  /** 対象業務のズレの信号（段階 6 で使う） */
  driftSignal: number;
  scopeRelation?: string;
  /** 問いかけの間合いの信号 0..4（段階 5 で使う） */
  grillScore: number;
  intent?: { name: string; confidence: number };
  followUps: FollowUp[];
  /** 前の発話で gemma が作った文言の検証結果 */
  checks: CheckResult[];
};

type Answers = Record<string, JevAnswer | undefined>;

function noul(a: Answers, key: string): number | null {
  const v = a[key] as JevNoulAnswer | undefined;
  return v && v.type === "noul" ? v.noul : null;
}

function choice(a: Answers, key: string): JevChoiceAnswer | null {
  const v = a[key];
  return v && v.type === "choice" ? v : null;
}

function score(a: Answers, key: string): JevScoreAnswer | null {
  const v = a[key];
  return v && v.type === "score" ? v : null;
}

const fmt = (n: number) => n.toFixed(2);

/** ステップ名の暫定文。gemma の文言が入る（または採用されない）までの間、発話の先頭を使う。 */
export function fallbackLabel(utterance: string): string {
  const oneLine = utterance.replace(/\s+/g, " ").replace(/[。．.！!？?]+$/, "").trim();
  return oneLine.length > FALLBACK_LABEL_CHARS
    ? `${oneLine.slice(0, FALLBACK_LABEL_CHARS)}…`
    : oneLine;
}

/** "S12" のような接頭辞つき連番の、次の id。 */
export function nextId(prefix: string, ids: string[]): string {
  const max = ids.reduce((m, id) => {
    const n = id.startsWith(prefix) ? Number(id.slice(prefix.length)) : NaN;
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

const MESSAGE_KINDS: MessageKind[] = ["sync", "async", "reply", "self"];

const FLAG_ISSUES: {
  flag: keyof StepFlags;
  answer: string;
  kind: IssueKind;
  question: (excerpt: string) => string;
}[] = [
  {
    flag: "tacit",
    answer: "tacit_flag",
    kind: "criteria",
    question: (e) => `この判断の基準は明文化されていますか？（発言: 「${e}」）`,
  },
  {
    flag: "personDependent",
    answer: "person_dependent_flag",
    kind: "who",
    question: (e) => `この処理は、特定の人にしか分からない状態になっていませんか？（発言: 「${e}」）`,
  },
  {
    flag: "exception",
    answer: "exception_flag",
    kind: "exception",
    question: (e) => `この例外対応の条件と手順は決まっていますか？（発言: 「${e}」）`,
  },
];

type Ctx = { utterance: string; utteranceId: string; checks?: PendingCheck[] };

/** 発話の解釈と、前の発話で gemma が作った文言の検証結果をまとめて返す。 */
export function interpret(answers: Answers, model: FlowModel, ctx: Ctx): Interpretation {
  const core = interpretUtterance(answers, model, ctx);
  const { ops: checkOps, results } = interpretChecks(answers, model, ctx.checks ?? []);
  if (results.length === 0) return { ...core, checks: [] };

  const detail = results
    .filter((r) => r.outcome !== "ok" && r.outcome !== "stale")
    .map((r) => `${r.key}: ${r.detail}`);
  return {
    ...core,
    // 検証で直すのは過去の文言なので、今回の発話の ops より先に適用する
    ops: [...checkOps, ...core.ops],
    checks: results,
    summary: detail.length > 0 ? `${core.summary} / 検証: ${detail.join("、")}` : core.summary,
  };
}

function interpretChecks(
  answers: Answers,
  model: FlowModel,
  checks: PendingCheck[],
): { ops: ModelOp[]; results: CheckResult[] } {
  const ops: ModelOp[] = [];
  const results: CheckResult[] = [];

  for (const c of checks) {
    const key = checkKey(c);
    if (!isLiveCheck(model, c)) {
      results.push({ key, outcome: "stale", detail: "対象が変わったため検証しません" });
      continue;
    }

    if (c.kind === "label") {
      const faithful = noul(answers, qFaithful(c.stepId));
      const readable = score(answers, qReadable(c.stepId));
      if (faithful === null) continue; // 回答が返ってこなかった。検証待ちのまま残す

      if (faithful < FAITHFUL_MIN) {
        ops.push({
          op: "step.update",
          id: c.stepId,
          patch: { label: fallbackLabel(c.source) },
        });
        results.push({
          key,
          outcome: "fallback",
          detail: `「${c.label}」は発話に無い情報を含む疑い（忠実さ ${fmt(faithful)}）。発話の先頭に戻しました`,
        });
      } else if (readable && readable.score < READABLE_MIN && c.attempts < MAX_LABEL_ATTEMPTS) {
        results.push({
          key,
          outcome: "relabel",
          detail: `「${c.label}」は名前として不適切（可読性 ${fmt(readable.score)}）。作り直します`,
        });
      } else {
        results.push({
          key,
          outcome: "ok",
          detail: `「${c.label}」を採用（忠実さ ${fmt(faithful)}${readable ? `・可読性 ${fmt(readable.score)}` : ""}）`,
        });
      }
      continue;
    }

    const dup = choice(answers, qActorDup(c.actorId));
    if (!dup) continue;
    if (
      dup.choice !== NO_DUP_ACTOR &&
      dup.confidence >= ACTOR_DUP_MIN &&
      model.actors.some((a) => a.id === dup.choice)
    ) {
      ops.push({ op: "actor.merge", from: c.actorId, into: dup.choice });
      results.push({
        key,
        outcome: "merged",
        detail: `「${c.name}」は ${dup.choice} の言い換えだったため統合しました（${fmt(dup.confidence)}）`,
      });
    } else {
      results.push({ key, outcome: "ok", detail: `「${c.name}」は新しい登場人物です` });
    }
  }
  return { ops, results };
}

function interpretUtterance(
  answers: Answers,
  model: FlowModel,
  ctx: Ctx,
): Omit<Interpretation, "checks"> {
  const chatter = noul(answers, "chatter");
  const driftSignal = noul(answers, "scope_drift") ?? 0;
  const relation = choice(answers, "scope_relation");
  const grillScore = score(answers, "grill_now")?.score ?? 0;
  const intentAnswer = choice(answers, "intent");

  const base = {
    chatter: chatter ?? 0,
    driftSignal,
    scopeRelation: relation?.choice,
    grillScore,
    intent: intentAnswer
      ? { name: intentAnswer.choice, confidence: intentAnswer.confidence }
      : undefined,
    followUps: [] as FollowUp[],
  };

  if (chatter === null) {
    return { ...base, verdict: "unchanged", ops: [], summary: "jev の回答に chatter がありません" };
  }
  if (chatter >= CHATTER_DROP) {
    return {
      ...base,
      verdict: "drop",
      ops: [],
      summary: `雑談として図には反映しません（雑談 ${fmt(chatter)}）`,
    };
  }

  const ops: ModelOp[] = [];
  const notes: string[] = [];
  const followUps = base.followUps;
  let verdict: Verdict = "unchanged";
  const intent =
    intentAnswer && intentAnswer.confidence >= INTENT_MIN ? intentAnswer.choice : "other";

  // 1 回の解釈の中で採番が衝突しないよう、追加した id を覚えておく
  const stepIds = model.steps.map((s) => s.id);
  const issueIds = model.issues.map((i) => i.id);
  let targetStepId: string | null = null;

  const dup = choice(answers, "dup_step");
  const dupStep =
    dup && dup.choice !== NO_STEP && dup.confidence >= DUP_CONFIDENT
      ? model.steps.find((s) => s.id === dup.choice && s.status !== "retracted")
      : undefined;
  // 「依頼」と「その返答」は、同じ 2 者の間で向きが逆になるだけで、言い回しが似る。
  // 送り手・受け手が**確信をもって**既存ステップと違うと答えているなら、重複とは見ない。
  const fromAns = choice(answers, "actor_from");
  const toAns = choice(answers, "actor_to");
  const sure = (c: JevChoiceAnswer | null) =>
    c !== null && c.confidence >= ACTOR_APPLY && c.choice !== UNKNOWN_ACTOR && c.choice !== NEW_ACTOR;
  const differentDirection =
    !!dupStep && ((sure(fromAns) && fromAns?.choice !== dupStep.from) || (sure(toAns) && toAns?.choice !== dupStep.to));
  const dupId = dupStep && !differentDirection ? dupStep.id : null;

  const flags: StepFlags = {};
  for (const f of FLAG_ISSUES) {
    const p = noul(answers, f.answer);
    if (p !== null && p >= FLAG_MIN) flags[f.flag] = true;
  }
  const branchHint = noul(answers, "branch_marker") ?? 0;
  const artifactHint = noul(answers, "artifact_present") ?? 0;

  switch (intent) {
    case "describe_step":
    case "describe_condition": {
      if (dupId) {
        targetStepId = dupId;
        const existing = model.steps.find((s) => s.id === dupId);
        const merged = { ...existing?.flags, ...flags };
        if (Object.keys(flags).length > 0) {
          ops.push({ op: "step.update", id: dupId, patch: { flags: merged } });
          verdict = "apply";
        }
        notes.push(`既存ステップ ${dupId} と同じ内容です（${fmt(dup?.confidence ?? 0)}）`);
        break;
      }

      const from = choice(answers, "actor_from");
      const to = choice(answers, "actor_to");
      const spec = score(answers, "specificity");

      const isUnknown = (c: JevChoiceAnswer | null) => !c || c.choice === UNKNOWN_ACTOR;
      const isNew = (c: JevChoiceAnswer | null) => c?.choice === NEW_ACTOR;

      if (isUnknown(from) || isUnknown(to)) {
        verdict = "confirm";
        notes.push("送り手・受け手を特定できないため図に追加しません");
        break;
      }
      if (!spec || spec.score < SPECIFICITY_ADD_MIN) {
        verdict = "confirm";
        notes.push(`具体性が足りないため図に追加しません（具体性 ${fmt(spec?.score ?? 0)}）`);
        break;
      }

      const mk = choice(answers, "message_kind");
      const messageKind: MessageKind =
        mk && (MESSAGE_KINDS as string[]).includes(mk.choice) ? (mk.choice as MessageKind) : "sync";

      if (isNew(from) || isNew(to)) {
        // 名前は jev には作れない。gemma に特定させ、ステップはそのあと追加する
        const resolved = [from, to].filter((c) => !isNew(c)) as JevChoiceAnswer[];
        followUps.push({
          kind: "actors",
          need: { from: isNew(from), to: isNew(to) },
          fromId: isNew(from) ? null : from!.choice,
          toId: isNew(to) ? null : to!.choice,
          messageKind,
          confidence: resolved.length > 0 ? Math.min(...resolved.map((c) => c.confidence)) : 1,
          specificity: spec.score,
          flags,
          branchHint,
          artifactHint,
        });
        verdict = "confirm";
        notes.push("新しい登場人物が含まれます。gemma で名前を特定します");
        break;
      }

      const fromId = from!.choice;
      const toId = to!.choice;
      const confidence = Math.min(from!.confidence, to!.confidence);
      const provisional = confidence < ACTOR_APPLY || spec.score < SPECIFICITY_APPLY;

      let kind: MessageKind = messageKind;
      if (fromId === toId) kind = "self";
      else if (kind === "self") kind = "sync";

      const id = nextId("S", stepIds);
      const order = model.steps.reduce((m, s) => Math.max(m, s.order), 0) + 1;
      targetStepId = id;
      ops.push({
        op: "step.add",
        step: {
          id,
          from: fromId,
          to: toId,
          label: fallbackLabel(ctx.utterance),
          kind,
          branchId: null,
          order,
          confidence,
          status: provisional ? "provisional" : "confirmed",
          flags,
          sourceUtteranceIds: [ctx.utteranceId],
        },
      });
      followUps.push({ kind: "label", stepId: id, branchHint, artifactHint });
      verdict = provisional ? "confirm" : "apply";
      notes.push(
        provisional
          ? `仮ステップとして追加しました（確信度 ${fmt(confidence)}・具体性 ${fmt(spec.score)}）`
          : `ステップを追加しました（確信度 ${fmt(confidence)}）`,
      );
      break;
    }

    case "describe_scope": {
      if (model.scope.purpose === "" && (intentAnswer?.confidence ?? 0) >= SCOPE_CONFIDENT) {
        const purpose = ctx.utterance.replace(/\s+/g, " ").replace(/[。．.]+$/, "").trim();
        ops.push({ op: "scope.set", patch: { purpose } });
        verdict = "apply";
        notes.push("業務の目的として記録しました");
      } else {
        notes.push("業務全体についての発言です（目的は記録済み、または確信が足りません）");
      }
      break;
    }

    case "answer_question":
      notes.push("問いかけへの回答です");
      break;
    case "describe_actor":
      notes.push("登場人物の説明です");
      break;
    case "correct_previous":
      notes.push("訂正の発言です（図の訂正は次の段階）");
      break;
    case "ask_question":
      notes.push("質問です。図には反映しません");
      break;
    case "meta":
      notes.push("進め方の発言です。図には反映しません");
      break;
    default:
      notes.push("図に反映する内容を特定できませんでした");
  }

  // 暗黙知・属人化・例外は、grill の種になる。**対象ステップが無くても論点として積む**
  // （実データで、図に載せられない発話（具体性が低い）ほど「ケースバイケース」が出た）。
  // ただし 1 発話につき最も強いフラグ 1 つだけ。複数積むと同じ話の質問が並んでノイズになる。
  const strongest = FLAG_ISSUES.map((f) => ({ f, p: noul(answers, f.answer) ?? 0 }))
    .filter((x) => x.p >= FLAG_MIN)
    .sort((a, b) => b.p - a.p)[0];
  if (strongest) {
    const { f } = strongest;
    const question = f.question(fallbackLabel(ctx.utterance));
    const already = model.issues.some(
      (i) =>
        i.status !== "answered" &&
        (targetStepId
          ? i.kind === f.kind && i.relatedStepIds.includes(targetStepId)
          : i.question === question),
    );
    if (!already) {
      const issue: NewIssue = {
        id: nextId("I", issueIds),
        question,
        kind: f.kind,
        relatedStepIds: targetStepId ? [targetStepId] : [],
        status: "open",
      };
      issueIds.push(issue.id);
      ops.push({ op: "issue.add", issue });
      if (verdict === "unchanged") verdict = "apply";
      notes.push(`論点を追加しました（${f.kind} ${fmt(strongest.p)}）`);
    }
  }

  // どの意図でも、未解決の論点への答えなら解決済みにする
  const ans = choice(answers, "answers_issue");
  if (
    ans &&
    ans.choice !== NO_ISSUE &&
    ans.confidence >= ISSUE_ANSWERED &&
    model.issues.some((i) => i.id === ans.choice && i.status !== "answered")
  ) {
    ops.push({ op: "issue.resolve", id: ans.choice, answer: ctx.utterance });
    // 目的の問い（存在意義）への答えなら、対象業務の目的としても記録する
    const answered = model.issues.find((x) => x.id === ans.choice);
    if (answered?.kind === "purpose" && model.scope.purpose === "" && !ops.some((o) => o.op === "scope.set")) {
      const purpose = ctx.utterance.replace(/\s+/g, " ").replace(/[。．.]+$/, "").trim();
      ops.push({ op: "scope.set", patch: { purpose } });
      notes.push("業務の目的として記録しました");
    }
    if (verdict === "unchanged") verdict = "apply";
    notes.push(`論点 ${ans.choice} が答えられました`);
  }

  return { ...base, verdict, ops, summary: notes.join(" / ") };
}
