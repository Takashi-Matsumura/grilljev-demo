import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { modelFromScope } from "../model/reducer";
import {
  isValidSlug,
  newSlug,
  parseSessionFile,
  toMeta,
  type SessionFile,
  type SessionMeta,
  type SessionPatch,
  type SessionSeed,
} from "./session-types";

/**
 * セッションの保存（SQLite）。server 専用。
 *
 * - 1 ファイルの DB（`sessions/sessions.db`。`SESSIONS_DIR` で場所を変えられる。.gitignore 済み）に
 *   1 行 1 会議。`model` / `seed` / `archives` / `lines` はそのまま JSON テキストで持つ
 *   （中身で検索する必要が無いので、列に正規化する意味が薄い）
 * - `node:sqlite`（Node 標準ライブラリ）を使う。追加の依存を増やさないため
 * - `DatabaseSync` の呼び出しは同期・単一スレッドなので、1 回の呼び出しの**途中**に
 *   別のリクエストが割り込むことはない（JSON ファイル版にあった per-slug のキューは不要になった）
 * - slug はテーブルの主キー。形式だけ検証してから使う（`isValidSlug`）
 */

let cached: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (cached) return cached;
  // SESSIONS_DIR は実行時のデータ置き場で、バンドルに含めるものは無い。turbopack の静的解析は
  // ここを「プロジェクト全体をトレースする動的アクセス」と見なすため、明示的に対象外にする
  // （付けないと public を含む全ソースがサーバ出力に入る）。絶対パス指定を許すので cwd 配下には固定できない。
  const dir = path.resolve(/*turbopackIgnore: true*/ process.env.SESSIONS_DIR ?? path.join(process.cwd(), "sessions"));
  mkdirSync(dir, { recursive: true });
  const conn = new DatabaseSync(path.join(dir, "sessions.db"));
  conn.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      seed TEXT NOT NULL,
      model TEXT NOT NULL,
      archives TEXT NOT NULL,
      lines TEXT NOT NULL
    )
  `);
  cached = conn;
  return conn;
}

type Row = {
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
  seed: string;
  model: string;
  archives: string;
  lines: string;
};

/** 行 → SessionFile。JSON が壊れている・形が合わない行は null（壊れたセッションは飛ばす）。 */
function rowToFile(row: Row): SessionFile | null {
  try {
    return parseSessionFile({
      version: 1,
      slug: row.slug,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      seed: JSON.parse(row.seed),
      model: JSON.parse(row.model),
      archives: JSON.parse(row.archives),
      lines: JSON.parse(row.lines),
    });
  } catch {
    return null;
  }
}

export async function createSession(name: string, seed: SessionSeed): Promise<SessionFile> {
  const at = new Date().toISOString();
  const conn = db();
  // 同じ秒に作っても衝突しないよう、存在しない slug が出るまで引き直す
  for (let i = 0; i < 5; i += 1) {
    const slug = newSlug(new Date());
    const exists = conn.prepare("SELECT 1 FROM sessions WHERE slug = ?").get(slug);
    if (exists) continue;
    const file: SessionFile = {
      version: 1,
      slug,
      name,
      createdAt: at,
      updatedAt: at,
      seed,
      model: modelFromScope(seed.title, seed.departments, at),
      archives: [],
      lines: [],
    };
    conn
      .prepare(
        `INSERT INTO sessions (slug, name, created_at, updated_at, seed, model, archives, lines)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        file.slug,
        file.name,
        file.createdAt,
        file.updatedAt,
        JSON.stringify(file.seed),
        JSON.stringify(file.model),
        JSON.stringify(file.archives),
        JSON.stringify(file.lines),
      );
    return file;
  }
  throw new Error("セッションの id を作れませんでした");
}

export async function readSession(slug: unknown): Promise<SessionFile | null> {
  if (!isValidSlug(slug)) return null;
  const row = db().prepare("SELECT * FROM sessions WHERE slug = ?").get(slug) as Row | undefined;
  return row ? rowToFile(row) : null;
}

/** 中身（図・過去の図・文字起こし）を保存する。存在しないセッションには保存しない。 */
export async function saveSession(slug: unknown, patch: SessionPatch): Promise<SessionFile | null> {
  if (!isValidSlug(slug)) return null;
  const current = await readSession(slug);
  if (!current) return null;
  const next: SessionFile = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db()
    .prepare(
      `UPDATE sessions SET updated_at = ?, model = ?, archives = ?, lines = ? WHERE slug = ?`,
    )
    .run(next.updatedAt, JSON.stringify(next.model), JSON.stringify(next.archives), JSON.stringify(next.lines), slug);
  return next;
}

/** 会議名（一覧に出す表示名）だけを変える。対象業務そのもの（seed/model.scope.title）は変えない。 */
export async function renameSession(slug: unknown, name: string): Promise<SessionFile | null> {
  if (!isValidSlug(slug)) return null;
  const current = await readSession(slug);
  if (!current) return null;
  const next: SessionFile = { ...current, name, updatedAt: new Date().toISOString() };
  db().prepare(`UPDATE sessions SET name = ?, updated_at = ? WHERE slug = ?`).run(name, next.updatedAt, slug);
  return next;
}

/** 一覧（更新の新しい順）。壊れたセッションは飛ばす。 */
export async function listSessions(): Promise<SessionMeta[]> {
  const rows = db().prepare("SELECT * FROM sessions").all() as Row[];
  const metas: SessionMeta[] = [];
  for (const row of rows) {
    const file = rowToFile(row);
    if (file) metas.push(toMeta(file));
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSession(slug: unknown): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  const result = db().prepare("DELETE FROM sessions WHERE slug = ?").run(slug);
  return result.changes > 0;
}
