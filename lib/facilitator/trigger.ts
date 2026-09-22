/**
 * ファシリテーターが自動で問いかけを出すタイミング。純関数。
 *
 * 毎発話で出すと gemma が詰まり、会議も遮られる。**前回から一定時間あいていて、かつ**
 * 「間が空いた」「論点が溜まった」などのどれかが成り立ったときだけ生成を始める。
 * 生成した結果を実際に出すかは、Jev が別に判断する（出さず黙ることもある）。
 */

/** 前回の問い（無ければ会議の開始）から、これだけ経つまでは出さない */
export const COOLDOWN_MS = 45_000;
/** 最後の発話からこれだけ黙っていたら、間が空いたとみなす */
export const SILENCE_MS = 4_000;
/** Jev の grill_now(score 0..4) がこれ以上なら、いま挟んでよい流れとみなす */
export const GRILL_SCORE_MIN = 3.0;
/** 未解決の論点がこれだけ溜まったら、聞く */
export const ISSUE_PILE = 3;
/** 何も出さないまま、これだけ経ったら聞く */
export const LONG_IDLE_MS = 90_000;
/** Jev が「いまは黙る」「出せる候補なし」としたあと、再判定までの待ち */
export const RETRY_HOLD_MS = 20_000;
/** 生成に失敗したあと、再試行までの待ち（落ちている相手を叩き続けない） */
export const RETRY_ERROR_MS = 30_000;

export type TriggerContext = {
  now: number;
  /** すでに質問を出していて、まだ答え・保留になっていない（1 度に 1 問） */
  hasAsked: boolean;
  /** 判定した発話の数（0 ならまだ何も話されていない） */
  analyzed: number;
  /** 最初に判定した時刻（会議の開始） */
  startedAt: number;
  lastActivityAt: number;
  lastAskedAt: number;
  /** 再判定を待っている場合の、次に試してよい時刻 */
  nextEligibleAt: number;
  grillScore: number;
  purposeMissing: boolean;
  openIssues: number;
};

export function shouldTrigger(c: TriggerContext): boolean {
  if (c.hasAsked) return false;
  if (c.analyzed === 0) return false;
  if (c.now < c.nextEligibleAt) return false;

  const since = c.now - (c.lastAskedAt || c.startedAt);
  if (since < COOLDOWN_MS) return false;

  return (
    c.purposeMissing || // 存在意義が未確定 = 最優先（ops-grill の第一原理）
    c.grillScore >= GRILL_SCORE_MIN ||
    c.now - c.lastActivityAt >= SILENCE_MS ||
    c.openIssues >= ISSUE_PILE ||
    since >= LONG_IDLE_MS
  );
}
