import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
 * セッションの保存（JSON ファイル）。server 専用。DB は使わない。
 *
 * - `sessions/<slug>/session.json`（`SESSIONS_DIR` で場所を変えられる。.gitignore 済み）
 * - slug は厳格に検証してから使う（パス区切りや `..` でディレクトリの外へ出さない）
 * - 書き込みは一時ファイルに書いてから rename（途中で落ちても、壊れた JSON を残さない）
 * - 同じセッションへの書き込みは 1 つずつ順番に行う（自動保存が重なっても混ざらない）
 */

const baseDir = (): string => path.resolve(process.env.SESSIONS_DIR ?? path.join(process.cwd(), "sessions"));

/** slug からファイルの場所を決める。検証に通らなければ null。基準ディレクトリの外は必ず弾く。 */
function locate(slug: unknown): { dir: string; file: string } | null {
  if (!isValidSlug(slug)) return null;
  const base = baseDir();
  const dir = path.resolve(base, slug);
  if (path.dirname(dir) !== base) return null;
  return { dir, file: path.join(dir, "session.json") };
}

const queues = new Map<string, Promise<unknown>>();

/** 同じ slug への処理を直列にする。前の処理が失敗しても、次は動く。 */
function serial<T>(slug: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(slug) ?? Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(slug, tail);
  void tail.then(() => {
    if (queues.get(slug) === tail) queues.delete(slug);
  });
  return run;
}

async function writeAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(data), "utf-8");
  await rename(tmp, file);
}

export async function createSession(name: string, seed: SessionSeed): Promise<SessionFile> {
  const now = new Date();
  const at = now.toISOString();
  // 同じ秒に作っても衝突しないよう、存在しない slug が出るまで引き直す
  for (let i = 0; i < 5; i += 1) {
    const slug = newSlug(now);
    const loc = locate(slug);
    if (!loc) continue;
    if ((await readSession(slug)) !== null) continue;
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
    await mkdir(loc.dir, { recursive: true });
    await serial(slug, () => writeAtomic(loc.file, file));
    return file;
  }
  throw new Error("セッションの id を作れませんでした");
}

export async function readSession(slug: unknown): Promise<SessionFile | null> {
  const loc = locate(slug);
  if (!loc) return null;
  try {
    return parseSessionFile(JSON.parse(await readFile(loc.file, "utf-8")));
  } catch {
    return null; // 無い・壊れている
  }
}

/** 中身（図・過去の図・文字起こし）を保存する。存在しないセッションには保存しない。 */
export async function saveSession(slug: unknown, patch: SessionPatch): Promise<SessionFile | null> {
  const loc = locate(slug);
  if (!loc || !isValidSlug(slug)) return null;
  return serial(slug, async () => {
    const current = await readSession(slug);
    if (!current) return null;
    const next: SessionFile = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await writeAtomic(loc.file, next);
    return next;
  });
}

/** 一覧（更新の新しい順）。壊れたセッションは飛ばす。 */
export async function listSessions(): Promise<SessionMeta[]> {
  let names: string[];
  try {
    names = await readdir(baseDir());
  } catch {
    return []; // まだ 1 つも作っていない
  }
  const metas: SessionMeta[] = [];
  for (const name of names) {
    const file = await readSession(name);
    if (file) metas.push(toMeta(file));
  }
  return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteSession(slug: unknown): Promise<boolean> {
  const loc = locate(slug);
  if (!loc || !isValidSlug(slug)) return false;
  return serial(slug, async () => {
    if ((await readSession(slug)) === null) return false;
    await rm(loc.dir, { recursive: true, force: true });
    return true;
  });
}
