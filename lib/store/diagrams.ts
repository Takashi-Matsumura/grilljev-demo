import { emptyModel } from "../model/reducer";
import { isFlowModel } from "../model/guard";
import { db } from "./db";
import { isValidSlug, newSlug } from "./session-types";
import { toDiagramMeta, type DiagramFile, type DiagramMeta, type DiagramPatch } from "./diagram-types";

/**
 * 手で描く業務フロー図（/editor）の保存（SQLite の `diagrams` テーブル）。server 専用。
 * 1 行 1 図。`model` は JSON テキストのまま持つ（sessions と同じ考え方）。
 */

type Row = {
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  model: string;
};

/** 行 → DiagramFile。JSON が壊れている・形が合わない行は null（壊れた図は飛ばす）。 */
function rowToFile(row: Row): DiagramFile | null {
  try {
    const model: unknown = JSON.parse(row.model);
    if (!isFlowModel(model)) return null;
    return { slug: row.slug, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at, model };
  } catch {
    return null;
  }
}

export async function createDiagram(name: string): Promise<DiagramFile> {
  const at = new Date().toISOString();
  const conn = db();
  // 同じ秒に作っても衝突しないよう、存在しない slug が出るまで引き直す
  for (let i = 0; i < 5; i += 1) {
    const slug = newSlug(new Date());
    if (conn.prepare("SELECT 1 FROM diagrams WHERE slug = ?").get(slug)) continue;
    const file: DiagramFile = { slug, name, createdAt: at, updatedAt: at, model: emptyModel({ title: name }, at) };
    conn
      .prepare(`INSERT INTO diagrams (slug, name, created_at, updated_at, model) VALUES (?, ?, ?, ?, ?)`)
      .run(file.slug, file.name, file.createdAt, file.updatedAt, JSON.stringify(file.model));
    return file;
  }
  throw new Error("図の id を作れませんでした");
}

export async function readDiagram(slug: unknown): Promise<DiagramFile | null> {
  if (!isValidSlug(slug)) return null;
  const row = db().prepare("SELECT * FROM diagrams WHERE slug = ?").get(slug) as Row | undefined;
  return row ? rowToFile(row) : null;
}

/** 図を保存する。存在しない図には保存しない。 */
export async function saveDiagram(slug: unknown, patch: DiagramPatch): Promise<DiagramFile | null> {
  if (!isValidSlug(slug)) return null;
  const current = await readDiagram(slug);
  if (!current) return null;
  const next: DiagramFile = { ...current, model: patch.model, updatedAt: new Date().toISOString() };
  db()
    .prepare(`UPDATE diagrams SET updated_at = ?, model = ? WHERE slug = ?`)
    .run(next.updatedAt, JSON.stringify(next.model), slug);
  return next;
}

/** 図の名前を変える。業務名（model.scope.title）も揃える。 */
export async function renameDiagram(slug: unknown, name: string): Promise<DiagramFile | null> {
  if (!isValidSlug(slug)) return null;
  const current = await readDiagram(slug);
  if (!current) return null;
  const next: DiagramFile = {
    ...current,
    name,
    model: { ...current.model, scope: { ...current.model.scope, title: name } },
    updatedAt: new Date().toISOString(),
  };
  db()
    .prepare(`UPDATE diagrams SET name = ?, model = ?, updated_at = ? WHERE slug = ?`)
    .run(name, JSON.stringify(next.model), next.updatedAt, slug);
  return next;
}

/** 一覧（更新の新しい順）。壊れた図は飛ばす。 */
export async function listDiagrams(): Promise<DiagramMeta[]> {
  const rows = db().prepare("SELECT * FROM diagrams").all() as Row[];
  const metas: DiagramMeta[] = [];
  for (const row of rows) {
    const file = rowToFile(row);
    if (file) metas.push(toDiagramMeta(file));
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteDiagram(slug: unknown): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  return db().prepare("DELETE FROM diagrams WHERE slug = ?").run(slug).changes > 0;
}
