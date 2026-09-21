/**
 * gemma が作った文言の「検証待ち」。次の発話の jev リクエストに相乗りさせて確かめる
 * （並列評価なのでレイテンシもラウンドトリップも増えない）。
 *
 * 型のみ + キー生成。クライアントとサーバの両方から使う。
 */

export type PendingCheck =
  | {
      kind: "label";
      stepId: string;
      /** gemma が付けたステップ名 */
      label: string;
      /** その元になった発話 */
      source: string;
      /** 何回目の生成か（作り直しの上限を決める） */
      attempts: number;
    }
  | { kind: "actor"; actorId: string; name: string };

export const checkKey = (c: PendingCheck): string =>
  c.kind === "label" ? `label:${c.stepId}` : `actor:${c.actorId}`;

/**
 * ok        問題なし
 * fallback  発話に無い情報が足されていた。暫定の文言（発話の先頭）へ戻した
 * relabel   図のステップ名として不適切。gemma に作り直させる
 * merged    既存アクターの言い換えだった。統合した
 * stale     対象がもう無い／文言が変わっている。検証しない
 */
export type CheckOutcome = "ok" | "fallback" | "relabel" | "merged" | "stale";

export type CheckResult = { key: string; outcome: CheckOutcome; detail: string };

/** 1 リクエストに相乗りさせる検証の上限（質問数とトークンを抑える） */
export const MAX_CHECKS_PER_REQUEST = 3;
