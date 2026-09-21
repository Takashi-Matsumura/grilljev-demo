import type { FlowModel, ModelOp } from "@/lib/model/types";

/** 過去の図。「図を分ける」で退避した現在の図（読み取り専用でタブに残る）。 */
export type ArchivedDiagram = {
  id: string;
  title: string;
  model: FlowModel;
  closedAt: string;
};

/**
 * 「図を分ける」: 新しい対象業務で図を始める。
 * 登場人物（会議の顔ぶれ）は引き継ぐが、ステップ・分岐・論点・目的は引き継がない
 * （別の業務の話なので、前の図の未解決の論点を持ち越すと混ざる）。
 */
export function splitModel(prev: FlowModel, title: string, at: string): FlowModel {
  return {
    rev: 0,
    scope: { title, purpose: "", trigger: "", frequency: "" },
    actors: prev.actors.map((a) => ({ ...a, addedAtRev: 0 })),
    steps: [],
    branches: [],
    issues: [],
    updatedAt: at,
  };
}

/** 「対象を差し替える / 広げる」: 図はそのまま、対象業務の名前だけを変える。 */
export function renameOps(title: string): ModelOp[] {
  return [{ op: "scope.set", patch: { title } }];
}
