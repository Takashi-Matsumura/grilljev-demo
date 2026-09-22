/**
 * 対象業務のズレ（会話が別の業務に移った）の検知。純関数。
 *
 * **1 回の scope_drift では動かさない。** 1 回のノイズで業務名の貼り替えを勧めるのは
 * 最悪の体験なので、直近の業務の発話 3 件の平均で見る。関係（別の業務 / 上位の枠組み /
 * 1 ステップの細分化）は、3 件のうち 2 件以上が同じものを指したときだけ採用する。
 */

export const DRIFT_WINDOW = 3;
/** 窓の scope_drift(noul) の平均がこれ以上でズレとみなす */
export const DRIFT_FIRE = 0.6;
/** バナーを出したあと、次の提案までの待ち */
export const SHIFT_COOLDOWN_MS = 60_000;
/** Jev が「現状のまま」と判断したあと、次の提案までの待ち */
export const SHIFT_KEEP_COOLDOWN_MS = 60_000;
/** 参加者が「同じ業務として続ける」を選んだあと、次の提案までの待ち */
export const SHIFT_DISMISS_COOLDOWN_MS = 5 * 60_000;

export type ShiftRelation = "sibling" | "parent" | "child";
const SHIFT_RELATIONS: readonly string[] = ["sibling", "parent", "child"];

export type DriftPoint = { drift: number; relation: string | undefined };

export function pushDrift(window: DriftPoint[], point: DriftPoint): DriftPoint[] {
  return [...window, point].slice(-DRIFT_WINDOW);
}

export function driftAverage(window: DriftPoint[]): number {
  return window.length === 0 ? 0 : window.reduce((s, p) => s + p.drift, 0) / window.length;
}

/** 窓で最も多い「ズレの種類」。2 件以上が一致しなければ null。 */
export function dominantRelation(window: DriftPoint[]): ShiftRelation | null {
  const counts = new Map<string, number>();
  for (const p of window) {
    if (p.relation && SHIFT_RELATIONS.includes(p.relation)) {
      counts.set(p.relation, (counts.get(p.relation) ?? 0) + 1);
    }
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [rel, n] of counts) {
    if (n > bestCount) {
      best = rel;
      bestCount = n;
    }
  }
  return best !== null && bestCount >= 2 ? (best as ShiftRelation) : null;
}

/** 提案を始めてよいか。始めるなら、ズレの種類を返す。 */
export function shouldPropose(input: {
  window: DriftPoint[];
  now: number;
  cooldownUntil: number;
  /** すでに提案の生成中、または未回答のバナーがある */
  busy: boolean;
}): ShiftRelation | null {
  if (input.busy || input.now < input.cooldownUntil) return null;
  if (input.window.length < DRIFT_WINDOW) return null;
  if (driftAverage(input.window) < DRIFT_FIRE) return null;
  return dominantRelation(input.window);
}
