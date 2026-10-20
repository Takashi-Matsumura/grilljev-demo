import { visibleSteps } from "@/lib/render/mermaid";
import type { Actor, FlowModel } from "@/lib/model/types";

/**
 * 登場人物（会議の前に登録した起点・終点・出席の有無）を、ファシリテーターの材料にする。純関数。
 *
 * 会話は「自分の作業」の周りにしか広がらない。図にまだつながっていない登場人物がいれば、
 * そこが業務フローの切れ目なので、そこをつなぐ問いを出す。
 */

export type StakeholderView = {
  name: string;
  role: "起点" | "終点" | null;
  /** 会議に出席しているか。登録していない（会話の中で出てきた）人は null */
  present: boolean | null;
  /** 図のステップに 1 本でも関わっているか */
  connected: boolean;
};

export function stakeholderViews(model: FlowModel): StakeholderView[] {
  const steps = visibleSteps(model);
  return [...model.actors]
    .sort((a, b) => a.lane - b.lane)
    .map((a) => ({
      name: a.name,
      role: a.role === "trigger" ? "起点" : a.role === "end" ? "終点" : null,
      present: a.present ?? null,
      connected: steps.some((s) => s.from === a.id || s.to === a.id),
    }));
}

/** Jev への state 用の 1 行表記。「経理（終点・出席なし・図にまだ出ていない）」 */
export function stakeholderLine(v: StakeholderView): string {
  const notes = [
    v.role,
    v.present === false ? "出席なし" : null,
    v.connected ? null : "図にまだ出ていない",
  ].filter(Boolean);
  return notes.length > 0 ? `${v.name}（${notes.join("・")}）` : v.name;
}

export type StakeholderGap = { actor: Actor; text: string };

/**
 * いちばん先に埋めるべき、登場人物のつながりの切れ目。無ければ null。
 * 優先順: 起点から何も出ていない → 終点に何も届いていない → 図にまだ出ていない登場人物（並び順）。
 * 業務は起点から始まって終点で終わるので、両端がつながると会話の行き先が決まる。
 */
export function stakeholderGap(model: FlowModel): StakeholderGap | null {
  const steps = visibleSteps(model);
  const ordered = [...model.actors].sort((a, b) => a.lane - b.lane);

  const trigger = ordered.find((a) => a.role === "trigger");
  if (trigger && !steps.some((s) => s.from === trigger.id)) {
    return { actor: trigger, text: `「${trigger.name}」から業務が始まるとき、最初に誰へ何が届きますか？` };
  }
  const end = ordered.find((a) => a.role === "end");
  if (end && !steps.some((s) => s.to === end.id && s.from !== end.id)) {
    return { actor: end, text: `最終的に「${end.name}」へは、誰から何が届きますか？` };
  }
  const loose = ordered.find((a) => !steps.some((s) => s.from === a.id || s.to === a.id));
  if (loose) {
    return { actor: loose, text: `「${loose.name}」は、この業務のどこで、誰とやり取りしますか？` };
  }
  return null;
}
