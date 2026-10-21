import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * 保存先の SQLite（`sessions/sessions.db`。`SESSIONS_DIR` で場所を変えられる。.gitignore 済み）。server 専用。
 *
 * - `sessions`: 会議（lib/store/sessions.ts）
 * - `diagrams`: 手で描く業務フロー図（/editor。lib/store/diagrams.ts）。会議とは混ぜない
 *
 * テーブルは起動時に `CREATE TABLE IF NOT EXISTS` で作る（マイグレーションの仕組みは持たない）。
 */

let cached: DatabaseSync | null = null;

export function db(): DatabaseSync {
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
    );
    CREATE TABLE IF NOT EXISTS diagrams (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      model TEXT NOT NULL
    );
  `);
  cached = conn;
  return conn;
}
