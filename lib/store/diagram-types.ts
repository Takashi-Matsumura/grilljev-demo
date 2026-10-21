import { isFlowModel } from "../model/guard";
import type { FlowModel } from "../model/types";

/**
 * 手で描く業務フロー図（/editor）の保存データ。純粋な部分（型・検証）。DB には触れない。
 * 保存は SQLite の `diagrams` テーブル（lib/store/diagrams.ts）。slug は会議と同じ形式（session-types の isValidSlug / newSlug）。
 */

export type DiagramFile = {
  slug: string;
  /** 一覧に出す図の名前（＝業務名。model.scope.title と揃える） */
  name: string;
  createdAt: string;
  updatedAt: string;
  model: FlowModel;
};

export type DiagramMeta = {
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  actors: number;
  steps: number;
};

/** 保存できる中身（クライアントが送ってくる部分）。 */
export type DiagramPatch = { model: FlowModel };

export function parseDiagramPatch(v: unknown): DiagramPatch | null {
  if (typeof v !== "object" || v === null) return null;
  const model = (v as Record<string, unknown>).model;
  return isFlowModel(model) ? { model } : null;
}

export function toDiagramMeta(file: DiagramFile): DiagramMeta {
  return {
    slug: file.slug,
    name: file.name,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    actors: file.model.actors.length,
    steps: file.model.steps.filter((s) => s.status !== "retracted").length,
  };
}
