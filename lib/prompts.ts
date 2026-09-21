import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * プロンプトは prompts/*.md に置く（コードに埋め込まない）。
 * dev では毎回読み直すので、文言の当たりを取るのに再起動が要らない。prod ではキャッシュする。
 */
export type PromptName =
  | "label-step"
  | "extract-actors"
  | "facilitator"
  | "suggest-answer"
  | "scope-shift";

const cache = new Map<PromptName, string>();

export async function loadPrompt(name: PromptName): Promise<string> {
  const dev = process.env.NODE_ENV === "development";
  if (!dev) {
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
  }
  const text = await readFile(path.join(process.cwd(), "prompts", `${name}.md`), "utf-8");
  if (!dev) cache.set(name, text);
  return text;
}
