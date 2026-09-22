import type { FlowModel } from "../model/types";

/**
 * whisper への語彙ヒント。会議が進むほど、モデルに入っている語彙（対象業務名・登場人物名と
 * 別名・書類/システム名）を自動で集めて足す。**これらはすでに Jev の判定・gemma の生成を経て
 * モデルに入った時点で検証済みの語彙**なので、ここで新たに Jev や gemma を呼ぶ必要はない
 * （呼ぶとしたら、まだモデルに入っていない候補語をあてずっぽうで拾う話になり、ハルシネーション
 * のリスクと追加コストに見合わない。まずはこの「無料で確実な語彙」から）。
 *
 * 利用者が手で追記する欄（まだ発言されていない固有名詞など）とは別に持ち、送信時に合成する。
 * 自動の語彙が伸びても、利用者が書いた分を上書き・切り詰めない。
 */

/** whisper に渡す語彙ヒントの文字数上限（サーバー側 `/api/transcribe` も同じ値で切る）。 */
export const MAX_VOCAB_CHARS = 200;

/** モデルから、検証済みの語彙を集める。重複は除き、上限に収まる分だけ（短い語を優先して詰める）。 */
export function autoVocab(model: FlowModel, maxChars: number = MAX_VOCAB_CHARS): string {
  const terms: string[] = [];
  if (model.scope.title) terms.push(model.scope.title);
  for (const a of model.actors) {
    terms.push(a.name, ...a.aliases);
  }
  for (const s of model.steps) {
    if (s.artifact) terms.push(s.artifact);
  }

  const seen = new Set<string>();
  let acc = "";
  for (const raw of terms) {
    const t = raw.trim();
    if (t === "" || seen.has(t)) continue;
    const next = acc ? `${acc}、${t}` : t;
    if (next.length > maxChars) continue; // この語は諦め、後続の短い語で埋める
    seen.add(t);
    acc = next;
  }
  return acc;
}

/**
 * 自動の語彙と、利用者が手で足した語彙を合わせる。**手入力は必ず全部残す**
 * （利用者の意図を自動処理で削らない）。自動の語彙は、残った文字数の分だけ、
 * 語の区切り（「、」）で切って添える。
 */
export function combineVocab(auto: string, manual: string, maxChars: number = MAX_VOCAB_CHARS): string {
  const m = manual.trim();
  if (m.length >= maxChars) return m.slice(0, maxChars);

  const sep = m && auto ? 1 : 0;
  const budget = maxChars - m.length - sep;
  let a = auto;
  if (a.length > budget) {
    const cut = a.slice(0, budget);
    const lastSep = cut.lastIndexOf("、");
    a = lastSep > 0 ? cut.slice(0, lastSep) : "";
  }
  return [a, m].filter(Boolean).join("、");
}
