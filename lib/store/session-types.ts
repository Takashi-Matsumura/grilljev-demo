import { isFlowModel } from "../model/guard";
import type { ActorKind, ActorRole, FlowModel } from "../model/types";
import type { ArchivedDiagram } from "../scope/apply";
import type { Line } from "../transcript/line";

/**
 * 会議（セッション）の保存データ。純粋な部分（型・検証・正規化）。DB には触れない。
 * 保存は SQLite（`sessions/sessions.db`。lib/store/sessions.ts）。
 */

/** 会議の前に登録する登場人物。並べた順がライフラインの並び（左から）になる。 */
export type SeedActor = {
  name: string;
  kind: Exclude<ActorKind, "unknown">;
  role?: ActorRole;
  /** 会議に出席しているか。null は未設定（システムなど） */
  present: boolean | null;
  /** 部署の中の人（担当者の候補） */
  members?: string[];
  /** 社内での呼び方・別名 */
  aliases?: string[];
  /** 製品・サービス名、会社名、正式名称 */
  product?: string;
  /** 補足 */
  note?: string;
};

/** 開始時の初期設定＝共通認識。「リセット」の戻り先にもなる。 */
export type SessionSeed = { title: string; actors: SeedActor[] };

export type SessionFile = {
  version: 1;
  slug: string;
  /** 一覧に出す会議の名前 */
  name: string;
  createdAt: string;
  updatedAt: string;
  seed: SessionSeed;
  /** いま作っている図 */
  model: FlowModel;
  /** 「図を分ける」で退避した過去の図 */
  archives: ArchivedDiagram[];
  /** 文字起こし */
  lines: Line[];
};

export type SessionMeta = {
  slug: string;
  name: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  actors: number;
  steps: number;
  lines: number;
  archives: number;
};

/** 保存できる中身（クライアントが送ってくる部分）。 */
export type SessionPatch = {
  model: FlowModel;
  archives: ArchivedDiagram[];
  lines: Line[];
};

// ── slug ───────────────────────────────────────────────────────────
/** ディレクトリ名になるので、パス区切りや `..` を通さない厳格な形だけを許す。 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isValidSlug = (v: unknown): v is string => typeof v === "string" && SLUG_RE.test(v);

/** `20260921-213045-x7k2`。並べると作成順になり、衝突しにくい。 */
export function newSlug(now: Date, random: () => string = () => Math.random().toString(36).slice(2, 6)): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const suffix = random().toLowerCase().replace(/[^a-z0-9]/g, "").padEnd(4, "0").slice(0, 4);
  return `${stamp}-${suffix}`;
}

// ── 入力の検証 ─────────────────────────────────────────────────────
export const MAX_NAME_CHARS = 60;
export const MAX_SEED_ACTORS = 20;
export const MAX_ACTOR_CHARS = 30;
export const MAX_MEMBERS = 20;
export const MAX_ALIASES = 10;
export const MAX_PRODUCT_CHARS = 40;
export const MAX_NOTE_CHARS = 200;
export const SEED_ACTOR_KINDS: SeedActor["kind"][] = ["role", "person", "system", "external"];
export const MAX_ARCHIVES = 50;
export const MAX_LINES = 2_000;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** 会議の名前。空・長すぎるものは弾く。 */
export function parseName(v: unknown): string | null {
  const s = clean(v);
  return s !== "" && s.length <= MAX_NAME_CHARS ? s : null;
}

/**
 * 初期設定（業務名 + 登場人物）。名前の空白・重複は除き、起点・終点はそれぞれ先頭の 1 人だけ残す。
 * 業務名が空なら null。`departments` は登場人物を導入する前の保存形式（部署名の配列）で、
 * `actors` が無いときだけ「出席している部署」として読む。
 */
export function parseSeed(title: unknown, actors: unknown, departments?: unknown): SessionSeed | null {
  const t = clean(title);
  if (t === "" || t.length > MAX_NAME_CHARS) return null;
  const list: unknown[] = Array.isArray(actors)
    ? actors
    : Array.isArray(departments)
      ? departments.map((name) => ({ name, kind: "role", present: true }))
      : [];
  const seen = new Set<string>();
  const roles = new Set<ActorRole>();
  const out: SeedActor[] = [];
  for (const v of list) {
    if (typeof v !== "object" || v === null) continue;
    const a = v as Record<string, unknown>;
    const name = clean(a.name);
    if (name === "" || name.length > MAX_ACTOR_CHARS || seen.has(name)) continue;
    seen.add(name);
    const kind = SEED_ACTOR_KINDS.find((k) => k === a.kind) ?? "role";
    const role = a.role === "trigger" || a.role === "end" ? a.role : undefined;
    // 出席は、書いていなければ出席とみなす（出席の有無を持つ前の保存形式）。null は未設定
    const actor: SeedActor = { name, kind, present: a.present === null ? null : a.present !== false };
    const names = (v: unknown, max: number) =>
      Array.isArray(v)
        ? [...new Set(v.map(clean).filter((n) => n !== "" && n !== name && n.length <= MAX_ACTOR_CHARS))].slice(0, max)
        : [];
    const members = names(a.members, MAX_MEMBERS);
    if (members.length > 0) actor.members = members;
    const aliases = names(a.aliases, MAX_ALIASES);
    if (aliases.length > 0) actor.aliases = aliases;
    const product = clean(a.product);
    if (product !== "" && product.length <= MAX_PRODUCT_CHARS) actor.product = product;
    const note = clean(a.note);
    if (note !== "" && note.length <= MAX_NOTE_CHARS) actor.note = note;
    if (role && !roles.has(role)) {
      roles.add(role);
      actor.role = role;
    }
    out.push(actor);
  }
  return { title: t, actors: out.slice(0, MAX_SEED_ACTORS) };
}

/** 「営業、経理, 与信部」のような 1 行の入力を、名前の配列にする（登場人物をまとめて足すとき）。 */
export function splitNames(input: string): string[] {
  return input.split(/[、,，\n]/).map((s) => s.trim()).filter((s) => s !== "");
}

const LINE_STATUS = ["transcribing", "done", "silent", "dropped", "error"];

function isLine(v: unknown): v is Line {
  if (typeof v !== "object" || v === null) return false;
  const l = v as Record<string, unknown>;
  return (
    typeof l.id === "string" &&
    typeof l.at === "string" &&
    typeof l.text === "string" &&
    typeof l.status === "string" &&
    LINE_STATUS.includes(l.status)
  );
}

function isArchive(v: unknown): v is ArchivedDiagram {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.id === "string" &&
    typeof a.title === "string" &&
    typeof a.closedAt === "string" &&
    isFlowModel(a.model)
  );
}

/** 保存リクエストの中身を確かめる。1 つでも形が違えば null（部分的に保存しない）。 */
export function parseSessionPatch(v: unknown): SessionPatch | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  if (!isFlowModel(p.model)) return null;
  if (!Array.isArray(p.archives) || p.archives.length > MAX_ARCHIVES || !p.archives.every(isArchive)) return null;
  if (!Array.isArray(p.lines) || p.lines.length > MAX_LINES || !p.lines.every(isLine)) return null;
  return { model: p.model, archives: p.archives, lines: p.lines };
}

/** 保存ファイルの形（version と必須項目）を確かめる。壊れたファイルは null。 */
export function parseSessionFile(v: unknown): SessionFile | null {
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (f.version !== 1 || !isValidSlug(f.slug)) return null;
  if (typeof f.name !== "string" || typeof f.createdAt !== "string" || typeof f.updatedAt !== "string") return null;
  const rawSeed = (f.seed ?? {}) as Record<string, unknown>;
  const seed = parseSeed(rawSeed.title, rawSeed.actors, rawSeed.departments);
  const patch = parseSessionPatch(f);
  if (!seed || !patch) return null;
  return {
    version: 1,
    slug: f.slug,
    name: f.name,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    seed,
    ...patch,
  };
}

/**
 * 保存した文字起こしを、再開できる形にする。
 * 保存した時点で処理中だったもの（文字起こし中・判定中・gemma の生成中）は、再開しても結果が
 * 戻ってこない。「処理中」のまま残すと永遠に回り続けるので、中断したものとして落とす。
 */
export function normalizeLoadedLines(lines: Line[]): Line[] {
  return lines.map((l) => {
    const next: Line = { ...l };
    if (next.status === "transcribing") next.status = "dropped";
    if (next.analysis?.state === "pending") delete next.analysis;
    if (next.labeling?.state === "pending") delete next.labeling;
    return next;
  });
}

export function toMeta(f: SessionFile): SessionMeta {
  return {
    slug: f.slug,
    name: f.name,
    title: f.model.scope.title,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    actors: f.model.actors.length,
    steps: f.model.steps.filter((s) => s.status !== "retracted").length,
    lines: f.lines.length,
    archives: f.archives.length,
  };
}
