import type { FlowModel } from "../model/types";
import { buildScenes, dropCondition, type Narration } from "../preview/scenes";

/**
 * 業務分掌の「業務の流れ」: 業務の開始から終了までを、図の手順番号を添えた文章にする。純関数。
 *
 * 流れの組み立て（分岐の入口・各場合・合流の言い方）は、フローの再生と同じ場面（lib/preview/scenes.ts）を使う。
 * 手順の文は AI の言い回し（lib/preview/narrate.ts）が届いていればそれを、無ければコードで作った文を使う。
 * 分岐の入口・各場合・合流で段落を分ける。返すのは段落の配列（Markdown の段落 1 つずつ）。
 */

/** 文末の「。」の前に「（手順 N）」を差し込む */
function withNumber(sentence: string, n: number): string {
  const s = sentence.trim().replace(/[。.]+$/, "");
  return `${s}（手順 ${n}）。`;
}

export function flowParagraphs(model: FlowModel, title: string, narration: Narration | null): string[] {
  const byId = new Map(model.actors.map((a) => [a.id, a.name]));
  const stepById = new Map(model.steps.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id) ?? "（不明）";

  /** AI の文が無いときの手順の文 */
  const fallback = (stepId: string): string => {
    const s = stepById.get(stepId);
    if (!s) return "";
    const what = `「${s.label.trim() || "（ステップ名が未入力）"}」`;
    const head = s.from === s.to ? `${nameOf(s.from)}が${what}を行います` : `${nameOf(s.from)}が${nameOf(s.to)}に対して${what}を行います`;
    const art = s.artifact?.trim() ? `。渡すものは「${s.artifact.trim()}」です` : "";
    const tentative = s.status === "provisional" ? "（まだ確かではありません）" : "";
    return `${head}${tentative}${art}。`;
  };

  const paragraphs: string[][] = [];
  const open = () => paragraphs.push([]);
  const add = (text: string) => {
    if (paragraphs.length === 0) open();
    paragraphs[paragraphs.length - 1].push(text);
  };

  for (const scene of buildScenes(model, title)) {
    const ai = scene.key ? narration?.[scene.key] : undefined;
    switch (scene.kind) {
      case "intro":
        add(ai ?? scene.caption);
        open();
        break;
      case "branch":
        open();
        add(scene.caption);
        break;
      case "arm":
        // alt の 1 つ目の場合は、入口の文と同じ段落に続ける
        if (!/^まず/.test(scene.caption)) open();
        // 条件そのものが「〜場合」「〜とき」で終わるときは、「「〜場合」の場合です」と重ねない
        add(scene.caption.replace(/(場合|とき)」の場合です/, "$1」です"));
        break;
      case "join":
        open();
        add(scene.caption);
        break;
      case "step": {
        const text = ai ? dropCondition(ai, scene.condition) : fallback(scene.key ?? "");
        add(withNumber(text, scene.number ?? 0));
        break;
      }
      case "outro":
        open();
        add(ai ?? scene.caption);
        break;
    }
  }
  return paragraphs.map((p) => p.join("")).filter((p) => p !== "");
}
