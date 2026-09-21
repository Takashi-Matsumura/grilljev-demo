/**
 * whisper の日本語出力から、音声ではなく学習データ由来の定型文を落とす。
 * 無音や雑音の区間で「ご視聴ありがとうございました」「（拍手）」などを吐くので、
 * これを通さないと図（業務ステップ）が汚染される。起動時の `-sns` と二重で効かせる。
 *
 * 保守的に作る: 括弧書きの効果音表記と ♪ は除去するが、定型フレーズは
 * 「それしか言っていない」場合だけ捨てる（業務の発話に混ざっていたら残す）。
 */

const NON_SPEECH_BRACKETS = /[(（\[［【][^)）\]］】]{0,20}[)）\]］】]/g;
const MUSIC_MARKS = /[♪♫🎵🎶]/g;

const HALLUCINATION_ONLY = [
  /^ご視聴ありがとうございました?[。!！]?$/,
  /^ご清聴ありがとうございました?[。!！]?$/,
  /^チャンネル登録(を|も)?お願いします[。!！]?$/,
  /^(最後までご覧いただき|ご覧いただき)ありがとうございました?[。!！]?$/,
  /^字幕(視聴者)?(による)?(翻訳)?[:：]?.*$/,
  /^おやすみなさい[。!！]?$/,
];

export type CleanResult = {
  text: string;
  /** 何か落としたか（デバッグ表示用） */
  filtered: boolean;
};

export function cleanJapanese(raw: string): CleanResult {
  const original = raw.trim();
  const stripped = original
    .replace(NON_SPEECH_BRACKETS, "")
    .replace(MUSIC_MARKS, "")
    .replace(/\s+/g, " ")
    .trim();

  // 記号しか残らないものは無音扱い
  if (stripped.replace(/[\s、。,.!！?？…・ー-]/g, "") === "") {
    return { text: "", filtered: original !== "" };
  }
  if (HALLUCINATION_ONLY.some((re) => re.test(stripped))) {
    return { text: "", filtered: true };
  }
  return { text: stripped, filtered: stripped !== original };
}
