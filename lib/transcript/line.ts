import type { Verdict } from "@/lib/analysis/interpret";

/** 1 行に対する Jev の判定結果（表示用の要約） */
export type LineAnalysis =
  | { state: "pending" }
  | {
      state: "done";
      verdict: Verdict;
      /** 雑談らしさ 0..1 */
      chatter: number;
      summary: string;
      /** サンプルの Jev モードで、台本の想定と一致したか */
      match?: "match" | "mismatch";
    }
  | { state: "error"; error: string };

/** 1 行に対する gemma の文言生成（ステップ名・登場人物）の状況 */
export type LineLabeling = {
  state: "pending" | "done" | "error";
  /** 進行中・結果の補足 */
  note?: string;
  /** 付けたステップ名 */
  label?: string;
  ms?: number;
  error?: string;
  /** 次の発話の Jev による検証の結果 */
  check?: { outcome: string; detail: string };
};

/** 文字起こし 1 行。マイク由来とサンプル再生由来の両方をこの型で持つ。 */
export type Line = {
  id: string;
  at: string;
  status: "transcribing" | "done" | "silent" | "dropped" | "error";
  text: string;
  /** whisper が返した生のテキスト。フィルタで落ちたものを確認するため */
  raw?: string;
  audioMs: number;
  latencyMs?: number;
  error?: string;
  /** サンプル台本から再生した行。マイクの実認識ではない */
  sample?: boolean;
  /** サンプルの「台本」モードでの分類（台本に固定で書いたもの。Jev の判定ではない） */
  tag?: "chatter" | "business";
  /** サンプルの Jev モードで、台本が想定している分類（Jev の判定との一致を見る用） */
  expected?: "chatter" | "business";
  analysis?: LineAnalysis;
  labeling?: LineLabeling;
};

export function clock(): string {
  return new Date().toLocaleTimeString("ja-JP", { hour12: false });
}
