import type { FlowModel, ModelOp } from "@/lib/model/types";

/**
 * 新しいステップの order を、**発話の順**に合わせる。
 *
 * ステップは、判定（jev）や後続処理（gemma で登場人物の名前を特定）が終わった順に図へ入る。
 * 後続処理は遅いことがあり、後に話した発話のステップが先に入ることがある。そのまま
 * 「いちばん後ろ」に足すと、話した順と図の並びが食い違い、「直前のステップの分岐と対になる」
 * 判定（else）も外れる。
 *
 * order は実数なので、自分より後に話した発話のステップがすでにあれば、その手前の隙間へ差し込む。
 * seqOf が undefined を返す（台本・手動・再開前の）ステップは、並べ替えの基準にしない。
 */
export function placeByUtterance(
  model: FlowModel,
  ops: ModelOp[],
  seqOf: (utteranceId: string) => number | undefined,
): ModelOp[] {
  const placed: { seq: number | undefined; order: number }[] = model.steps
    .filter((s) => s.status !== "retracted")
    .map((s) => ({ seq: seqOf(s.sourceUtteranceIds[0] ?? ""), order: s.order }));

  return ops.map((op): ModelOp => {
    if (op.op !== "step.add") return op;
    const seq = seqOf(op.step.sourceUtteranceIds[0] ?? "");
    let order = op.step.order;
    if (seq !== undefined) {
      const known = placed.filter((p): p is { seq: number; order: number } => p.seq !== undefined);
      const later = known.filter((p) => p.seq > seq);
      if (later.length > 0) {
        const upper = Math.min(...later.map((p) => p.order));
        const lower = Math.max(0, ...known.filter((p) => p.seq <= seq).map((p) => p.order));
        // すでに食い違っている（下限が上限以上）ときは、無理に動かさない
        if (lower < upper) order = (lower + upper) / 2;
      }
    }
    placed.push({ seq, order });
    return order === op.step.order ? op : { ...op, step: { ...op.step, order } };
  });
}
