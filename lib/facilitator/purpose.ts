import type { FlowModel } from "@/lib/model/types";

/**
 * 「業務の目的（存在意義）を、まず問うべきか」。純関数。クライアントとサーバの両方から使う。
 *
 * 目的が空で、**しかもまだ目的の問いを一度も出していない**ときだけ true。
 * 一度出した問いは、答えられても保留になっても繰り返さない（「目的が空のままなので
 * また聞く」を許すと、参加者が答えたのに同じ問いが延々と出続ける）。
 */
export function purposeMissing(model: FlowModel): boolean {
  if (model.scope.purpose.trim() !== "") return false;
  return !model.issues.some(
    (i) =>
      i.kind === "purpose" &&
      (i.status === "asked" || i.status === "answered" || i.status === "parked"),
  );
}
