import type { Branch, FlowModel, Step } from "@/lib/model/types";
import { drawnFrames, flowItems, visibleSteps } from "@/lib/render/mermaid";

/**
 * 業務フロー図の点検（/editor の「点検」パネル）。純関数。
 *
 * チームで描いた図には、描いた本人たちが気づきにくい抜けが残る。ここではコードで確実に言えるもの
 * （書き方の作法・流れの行き止まり・前提の空欄など）を拾う。業務として抜けていそうな手順のような、
 * 中身を読まないと言えない指摘は AI に任せる（lib/review/ai.ts）。
 */

export type Severity = "high" | "medium" | "low";
/** flow = 業務の流れ（抜け・行き止まり）/ notation = シーケンス図の書き方 / premise = 業務の前提 */
export type FindingCategory = "flow" | "notation" | "premise";

export type Finding = {
  /** 同じ指摘を見分ける鍵（規則の名前 + 対象） */
  id: string;
  severity: Severity;
  category: FindingCategory;
  title: string;
  detail: string;
  /** 関係するステップ。図の番号（1 始まり） */
  steps: number[];
  source: "rule" | "ai";
};

export const SEVERITY_LABEL: Record<Severity, string> = { high: "重要", medium: "確認", low: "提案" };
export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  flow: "業務の流れ",
  notation: "書き方",
  premise: "業務の前提",
};

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const bySeverity = (a: Finding, b: Finding) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];

/** 条件の言い方として「状態・場合」になっている印 */
const CONDITION_LIKE = /(場合|とき|時|なら|あり|なし|ある|ない|済|OK|NG|可|否|以上|以下|未満|超|中|前|後|まで|だけ|のみ)$/;
/** 動作の名前で終わっている印（「請求書の郵送」「メール送信」「入力する」） */
const ACTION_LIKE = /(する|す|る|う|く|ぐ|つ|ぬ|ぶ|む|送信|郵送|送付|発送|入力|登録|提出|連絡|依頼|作成|確認|承認|申請|通知|回付)$/;
/** 送って終わり（相手の返事を待たない）になりやすい手順 */
const SEND_LIKE = /(送|郵送|メール|通知|連絡|回す|回付|渡す|提出|差し?戻|転送|共有)/;
/** 差し戻し・却下など、その先の手当てが要る手順・場合 */
const REJECT_LIKE = /(差し?戻|却下|不備あり|NG|否認|不可|お断り|返却|再提出|修正依頼)/;

/** 図の番号（1 始まり） */
function numberOf(model: FlowModel): Map<string, number> {
  return new Map(visibleSteps(model).map((s, i) => [s.id, i + 1]));
}

export function reviewRules(model: FlowModel): Finding[] {
  const out: Finding[] = [];
  const steps = visibleSteps(model);
  const no = numberOf(model);
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? id;
  const frames = drawnFrames(model);
  const trigger = model.actors.find((a) => a.role === "trigger");
  const end = model.actors.find((a) => a.role === "end");

  // ---- 業務の前提 ----
  const missing = [
    !model.scope.purpose.trim() && "目的",
    !model.scope.trigger.trim() && "きっかけ",
    !model.scope.frequency.trim() && "頻度",
  ].filter((x): x is string => typeof x === "string");
  if (missing.length > 0) {
    out.push({
      id: "premise-missing",
      severity: "low",
      category: "premise",
      title: `業務の${missing.join("・")}が書かれていません`,
      detail:
        "何のための業務か・何が起きると始まるか・どれくらい起きるかは、図を初めて見る人が流れを読む手がかりになります。業務分掌の「業務概要」にも使われます。",
      steps: [],
      source: "rule",
    });
  }
  if (!trigger || !end) {
    out.push({
      id: "premise-roles",
      severity: "medium",
      category: "premise",
      title: `${!trigger && !end ? "起点と終点" : !trigger ? "起点" : "終点"}が決まっていません`,
      detail:
        "誰が業務を始め、最後に誰が成果を受け取るのかが決まると、流れの抜け（終点まで届いていない、など）を確かめられます。「登場人物を編集」で決められます。",
      steps: [],
      source: "rule",
    });
  }

  if (steps.length === 0) return out;

  // ---- 業務の流れ ----
  if (trigger && steps[0].from !== trigger.id) {
    out.push({
      id: "flow-first-not-trigger",
      severity: "low",
      category: "flow",
      title: `最初の手順が起点（${trigger.name}）から始まっていません`,
      detail: `起点は業務を始める人です。${trigger.name}が最初に何をするか（依頼・送付など）が抜けていないか、または起点の選び方が合っているかを確かめてください。`,
      steps: [1],
      source: "rule",
    });
  }

  // 流れの最後（分岐で終わるなら、各場合の最後）が終点に届いているか
  if (end) {
    const lastItem = flowItems(model).at(-1);
    const lastGroup = lastItem?.branch?.groupId;
    const tails: Step[] = lastGroup
      ? frames
          .find((arms) => arms[0].groupId === lastGroup)!
          .flatMap((arm) => {
            const last = steps.findLast((s) => s.branchId === arm.id);
            return last ? [last] : [];
          })
      : [steps[steps.length - 1]];
    const unreached = tails.filter((s) => s.to !== end.id && s.from !== end.id);
    if (unreached.length > 0) {
      out.push({
        id: "flow-end-not-reached",
        severity: "medium",
        category: "flow",
        title: `流れの最後が終点（${end.name}）に届いていません`,
        detail: `${unreached.map((s) => `${no.get(s.id)}「${s.label}」`).join("・")}で流れが終わっています。${end.name}が成果を受け取るまでの手順が抜けていないか、または終点の選び方が合っているかを確かめてください。`,
        steps: unreached.map((s) => no.get(s.id)!),
        source: "rule",
      });
    }
  }

  // 差し戻し・却下で終わる場合: その後（直して出し直す・やり直す）が無い
  // （枠は入れ子にできないので、くり返しの枠に囲まれているかは問わない）
  for (const arms of frames) {
    for (const arm of arms) {
      const armSteps = steps.filter((s) => s.branchId === arm.id);
      const last = armSteps.at(-1);
      const rejecting = REJECT_LIKE.test(arm.condition) || (last && REJECT_LIKE.test(last.label));
      if (!rejecting || !last) continue;
      const after = steps.filter((s) => s.order > last.order && !arms.some((b) => b.id === s.branchId));
      if (after.length > 0 || arm.kind === "loop") continue;
      out.push({
        id: `flow-reject-dead-end:${arm.id}`,
        severity: "high",
        category: "flow",
        title: "差し戻した後の流れがありません",
        detail: `［${arm.condition}］の場合は${no.get(last.id)}「${last.label}」で終わっています。差し戻された側が直して出し直し、もう一度確認に戻る、という流れが抜けていないか確かめてください。くり返すなら「くり返し」の枠で表せます。`,
        steps: armSteps.map((s) => no.get(s.id)!),
        source: "rule",
      });
    }
  }

  // 差し戻し・却下を判断する手順に、責任を持つ人（承認者）が決まっていない。業務分掌の責任分担表の A が空になる
  const noApprover = steps.filter((s) => REJECT_LIKE.test(s.label) && !s.approver);
  if (noApprover.length > 0) {
    out.push({
      id: "flow-no-approver",
      severity: "low",
      category: "flow",
      title: "差し戻しを判断する手順に、承認者が決まっていません",
      detail: `${noApprover.map((s) => `${no.get(s.id)}「${s.label}」`).join("・")}で差し戻すかどうかを、誰の責任で決めるのかが図にありません。ステップの編集の「承認者」で決めておくと、業務分掌の責任分担表に A として出ます。`,
      steps: noApprover.map((s) => no.get(s.id)!),
      source: "rule",
    });
  }

  // 1 人だけが担当している手順（属人化の候補）
  for (const actor of model.actors) {
    const single = singlePersonSteps(model, actor.id);
    if (!single) continue;
    const { who, steps: unflagged } = single;
    out.push({
      id: `flow-single-person:${actor.id}`,
      severity: "low",
      category: "flow",
      title: `${actor.name}の手順を${who}さん 1 人が担っています`,
      detail: `${who}さんが不在のときに止まらないか、判断の基準（何を見て決めるか）が手順として書けるかを、チームで確かめてください。確かめたら、手順に［属人］や［暗黙知］の印を付けておくと、あとで見直せます。`,
      steps: unflagged.map((s) => no.get(s.id)!),
      source: "rule",
    });
  }

  // 空の場合
  for (const arms of frames) {
    for (const arm of arms) {
      if (steps.some((s) => s.branchId === arm.id)) continue;
      out.push({
        id: `flow-empty-arm:${arm.id}`,
        severity: "medium",
        category: "flow",
        title: `［${arm.condition}］の場合の手順がまだありません`,
        detail: "この場合に何をするかを足すか、要らない場合なら消してください。",
        steps: [],
        source: "rule",
      });
    }
  }

  // 手順の無い登場人物
  for (const actor of model.actors) {
    if (steps.some((s) => s.from === actor.id || s.to === actor.id)) continue;
    out.push({
      id: `flow-idle-actor:${actor.id}`,
      severity: "low",
      category: "flow",
      title: `${actor.name}が流れに出てきません`,
      detail: `${actor.name}が関わる手順が抜けていないか、または登場人物から外してよいかを確かめてください。`,
      steps: [],
      source: "rule",
    });
  }

  // ---- 書き方 ----
  for (const arms of frames) {
    const actionLike = arms.filter((b) => isActionCondition(b));
    if (actionLike.length === 0) continue;
    out.push({
      id: `notation-condition:${arms[0].groupId}`,
      severity: "medium",
      category: "notation",
      title: "分岐の条件が、動作の名前になっています",
      detail: `${actionLike.map((b) => `［${b.condition}］`).join("・")}は、何かをする手順の名前に読めます。分岐の条件は「この場合なら」と読める状態で書くのが作法です（例:［メールで届いた場合］［不備あり］）。`,
      steps: [],
      source: "rule",
    });
  }

  const syncSends = syncSendSteps(model);
  if (syncSends.length > 0) {
    out.push({
      id: "notation-sync-send",
      severity: "low",
      category: "notation",
      title: "送って終わりの手順が「依頼（返事を待つ）」になっています",
      detail: `${syncSends.map((s) => `${no.get(s.id)}「${s.label}」`).join("・")}は、送った側が返事を待たないなら「通知（送るだけ）」の矢印のほうが実態に合います。返事を待つなら、返事の手順も足すと流れが閉じます。`,
      steps: syncSends.map((s) => no.get(s.id)!),
      source: "rule",
    });
  }

  const terse = terseSteps(model);
  if (terse.length > 0) {
    out.push({
      id: "notation-terse-label",
      severity: "low",
      category: "notation",
      title: "ステップ名が短く、それだけでは意味が取りにくいものがあります",
      detail: `${terse.map((s) => `${no.get(s.id)}「${s.label}」（${nameOf(s.from)} → ${nameOf(s.to)}）`).join("・")}。再生の字幕や書き出した表では名前だけで出るので、「請求書を郵送する」のように、何をどうするかまで書くと伝わります。`,
      steps: terse.map((s) => no.get(s.id)!),
      source: "rule",
    });
  }

  const provisional = steps.filter((s) => s.status === "provisional");
  if (provisional.length > 0) {
    out.push({
      id: "notation-provisional",
      severity: "low",
      category: "notation",
      title: `「仮」のままの手順が ${provisional.length} つあります`,
      detail: "確かめられたら「確定」にしてください。確信の無い手順は点線で描かれ、まとめの文書でも断定しない書き方になります。",
      steps: provisional.map((s) => no.get(s.id)!),
      source: "rule",
    });
  }

  return out.sort(bySeverity);
}

/** 送って終わり（返事を待たない）に読めるのに「依頼（返事を待つ）」になっている手順。直す案（fix.ts）でも使う */
export function syncSendSteps(model: FlowModel): Step[] {
  return visibleSteps(model).filter((s) => s.kind === "sync" && s.from !== s.to && SEND_LIKE.test(s.label));
}

/** 名前が短く、それだけでは意味が取りにくい手順 */
export function terseSteps(model: FlowModel): Step[] {
  return visibleSteps(model).filter((s) => [...s.label.trim()].length <= 5);
}

/**
 * 登場人物の手順を 1 人だけが担っていて、まだ［属人］の印が無いもの。当てはまらなければ null。
 * 部署のメンバーが 2 人以上いれば、たまたま 1 人が書かれているだけかもしれないので数えない
 */
export function singlePersonSteps(model: FlowModel, actorId: string): { who: string; steps: Step[] } | null {
  const actor = model.actors.find((a) => a.id === actorId);
  if (!actor || (actor.members?.length ?? 0) > 1) return null;
  const own = visibleSteps(model).filter((s) => s.from === actorId && s.assignee);
  const names = new Set(own.map((s) => s.assignee));
  const unflagged = own.filter((s) => !s.flags.personDependent);
  if (names.size !== 1 || unflagged.length === 0) return null;
  return { who: [...names][0]!, steps: unflagged };
}

/** 分岐の条件が、状態ではなく動作の名前に読めるか */
export function isActionCondition(branch: Branch): boolean {
  const c = branch.condition.replace(/[」』）)\]］\s]+$/, "").trim();
  if (c === "" || branch.kind === "loop") return false;
  return !CONDITION_LIKE.test(c) && ACTION_LIKE.test(c);
}
