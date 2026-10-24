import { notedTargets, noteState } from "../model/notes";
import type { FlowModel } from "../model/types";
import { visibleSteps } from "../render/mermaid";
import { reviewRules } from "../review/rules";

/**
 * 業務分掌を作れるところまで図が描けたか。純関数。
 *
 * 描き始めの図から分掌を作っても、部署ごとの担当業務がほとんど空の表になるだけなので、
 * 最低限の形（起点・終点と、いくつかの手順）ができるまでは作らせない（missing）。
 * それ以降は作れるが、点検の指摘・未決の付箋・仮の手順が残っていれば「まだ下書き」として知らせる（warnings）。
 */

/** 業務分掌を作れるようになる手順の数 */
export const MIN_DUTY_STEPS = 5;

export type DutiesReadiness = {
  ready: boolean;
  /** 作れるようになるまでに足りないもの */
  missing: string[];
  /** 作れるが、残っている未完成の点 */
  warnings: string[];
};

export function dutiesReadiness(model: FlowModel): DutiesReadiness {
  const steps = visibleSteps(model);
  const missing: string[] = [];
  const hasTrigger = model.actors.some((a) => a.role === "trigger");
  const hasEnd = model.actors.some((a) => a.role === "end");
  if (!hasTrigger || !hasEnd) {
    missing.push(`登場人物の${!hasTrigger && !hasEnd ? "起点と終点" : !hasTrigger ? "起点" : "終点"}を決める`);
  }
  if (steps.length < MIN_DUTY_STEPS) {
    missing.push(`ステップをあと ${MIN_DUTY_STEPS - steps.length} つ書く（${MIN_DUTY_STEPS} つ以上で作れます）`);
  }

  const warnings: string[] = [];
  const findings = reviewRules(model);
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  if (high + medium > 0) {
    const parts = [high > 0 && `「重要」${high} 件`, medium > 0 && `「確認」${medium} 件`].filter(Boolean);
    warnings.push(`フローの点検で ${parts.join("・")}の指摘が残っています`);
  }
  const openNotes = notedTargets(model).filter(({ note }) => noteState(note) === "open").length;
  if (openNotes > 0) warnings.push(`まだ決まっていない付箋が ${openNotes} 枚あります`);
  const provisional = steps.filter((s) => s.status === "provisional").length;
  if (provisional > 0) warnings.push(`「仮」のままの手順が ${provisional} つあります`);

  return { ready: missing.length === 0, missing, warnings };
}
