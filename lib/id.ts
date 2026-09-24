/**
 * 画面の中だけで使う一意な id（行・コンソールの記録・過去の図など）。
 *
 * `crypto.randomUUID()` は secure context でしか使えない。社内検証環境のように
 * `http://<ホストのIP>:<port>` で開くと存在せず、呼んだ時点で TypeError になって
 * 画面が黙って止まる（開発用サンプルの再生が始まらない、等）。
 *
 * `crypto.getRandomValues()` は insecure context でも使えるので、そちらで UUID v4 を組む。
 * ここで作る id は React の key と内部の突き合わせにしか使わず、秘密は持たない。
 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (n) => n.toString(16).padStart(2, "0"));
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10, 16).join("")}`;
}
