/**
 * 判定器の送り先の名前と、それを覚えておく cookie。
 * サーバ（lib/jev.ts）とブラウザ（use-jev-backend.ts）の両方から読むので、ここには何も秘密を置かない。
 */

export type JevBackend = "typesafe" | "local";

export const JEV_BACKENDS: readonly JevBackend[] = ["typesafe", "local"];

/** 画面の切り替えで書き、Route Handler が読む。 */
export const JEV_BACKEND_COOKIE = "grilljev_jev_backend";

export const JEV_BACKEND_LABELS: Record<JevBackend, string> = {
  typesafe: "Jev（TypeSafe）",
  local: "ローカル判定器",
};

export function parseJevBackend(v: unknown): JevBackend | null {
  return v === "typesafe" || v === "local" ? v : null;
}
