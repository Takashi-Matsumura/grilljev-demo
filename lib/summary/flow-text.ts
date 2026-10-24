import type { Branch, FlowModel } from "../model/types";
import { dropCondition, type Narration } from "../preview/scenes";
import { flowItems } from "../render/mermaid";

/**
 * 業務分掌の「業務の流れ」: 業務の開始から終了までを、まとまり（ブロック）ごとの箇条書きにする。純関数。
 *
 * 枠（分岐の各場合・条件付き・くり返し）と、その前後の枠の外の手順を 1 つずつのまとまりにし、
 * 中の手順を「（番号）文」の箇条書きで並べる。番号は図・ステップ一覧と同じ。
 * 手順の文は AI の言い回し（フローの再生と同じ lib/preview/narrate.ts）が届いていればそれを、無ければコードで作った文を使う。
 */

export type FlowBlock = {
  /** まとまりの形（「分岐: 「〜」の場合」「合流後」など）。コードが決める */
  title: string;
  /** 業務の名前（「請求書の受付」）。AI が付ける（lib/summary/phases.ts）。無ければ null */
  name: string | null;
  items: string[];
  stepIds: string[];
};
export type FlowText = { intro: string | null; blocks: FlowBlock[]; outro: string | null };

const cond = (b: Branch) => `「${b.condition.trim() || "（条件が未入力）"}」`;

function frameTitle(b: Branch): string {
  if (b.kind === "loop") return `くり返し: ${cond(b)}の間`;
  if (b.kind === "opt") return `条件付き: ${cond(b)}のときだけ`;
  // 条件そのものが「〜場合」「〜とき」で終わるときは、「「〜場合」の場合」と重ねない
  return `分岐: ${cond(b)}${/(場合|とき)$/.test(b.condition.trim()) ? "" : "の場合"}`;
}

export function flowText(
  model: FlowModel,
  narration: Narration | null,
  names: (string | null)[] | null = null,
): FlowText {
  const nameOf = (id: string) => model.actors.find((a) => a.id === id)?.name ?? "（不明）";
  const blocks: FlowBlock[] = [];
  let armId: string | null | undefined; // undefined = まだまとまりが無い / null = 枠の外
  let afterKind: Branch["kind"] | null = null;
  let n = 0;

  for (const { step, branch } of flowItems(model)) {
    const id = branch?.id ?? null;
    if (id !== armId) {
      const title = branch
        ? frameTitle(branch)
        : armId === undefined
          ? "開始"
          : afterKind === "alt"
            ? "合流後"
            : afterKind === "loop"
              ? "くり返しの後"
              : "その後";
      blocks.push({ title, name: names?.[blocks.length] ?? null, items: [], stepIds: [] });
      armId = id;
      if (branch) afterKind = branch.kind;
    }
    const block = blocks[blocks.length - 1];
    const items = block.items;
    if (step === null) {
      items.push("（この場合の手順は、まだ書かれていません）");
      continue;
    }
    n += 1;
    block.stepIds.push(step.id);
    const ai = narration?.[step.id];
    let text: string;
    if (ai) {
      text = dropCondition(ai, branch?.condition.trim());
    } else {
      const what = `「${step.label.trim() || "（ステップ名が未入力）"}」`;
      text =
        (step.from === step.to ? `${nameOf(step.from)}が${what}を行う` : `${nameOf(step.from)} → ${nameOf(step.to)}: ${what}`) +
        (step.status === "provisional" ? "（仮）" : "") +
        (step.artifact?.trim() ? `／渡すもの「${step.artifact.trim()}」` : "");
    }
    items.push(`**（${n}）**${text}`);
  }

  return { intro: narration?.intro ?? null, blocks, outro: narration?.outro ?? null };
}
