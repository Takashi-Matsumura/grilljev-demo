import type { FlowModel } from "./types";

/**
 * API に届いた FlowModel の形を確かめる。モデルは信頼できないクライアント入力なので、
 * 質問の組み立てに必要な形（配列と、業務名・目的の文字列）だけを検証する。
 */
export function isFlowModel(value: unknown): value is FlowModel {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Record<string, unknown>;
  const scope = m.scope as Record<string, unknown> | undefined;
  return (
    Array.isArray(m.actors) &&
    Array.isArray(m.steps) &&
    Array.isArray(m.issues) &&
    Array.isArray(m.branches) &&
    typeof scope === "object" &&
    scope !== null &&
    typeof scope.title === "string" &&
    typeof scope.purpose === "string"
  );
}
