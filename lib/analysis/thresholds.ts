/**
 * 判定の閾値。**実データで必ず調整するので、ここ 1 箇所に集める。**
 * jev-demo の plan.ts の作法を踏襲する: noul には confidence が無いので、
 * 0.5 からの距離で代用する。
 */

/** chatter(noul) がこれ以上なら雑談として図を動かさない */
export const CHATTER_DROP = 0.5;
/** intent の confidence がこれ未満なら、意図を決めつけず「その他」として扱う */
export const INTENT_MIN = 0.4;
/** specificity(score 0..4) がこれ未満なら、図には入れない（grill のネタ行き） */
export const SPECIFICITY_ADD_MIN = 1.5;
/** specificity がこれ未満なら、仮ステップ（点線）にする */
export const SPECIFICITY_APPLY = 2.5;
/** actor_from / actor_to の confidence がこれ未満なら、仮ステップにする */
export const ACTOR_APPLY = 0.7;
/** dup_step の confidence がこれ以上なら、追加ではなく既存ステップの更新に倒す */
export const DUP_CONFIDENT = 0.6;
/** answers_issue の confidence がこれ以上なら、論点が答えられたとみなす */
export const ISSUE_ANSWERED = 0.6;
/** describe_scope で目的を書き込む最低 confidence */
export const SCOPE_CONFIDENT = 0.6;
/**
 * exception / tacit / person_dependent の noul がこれ以上ならフラグを立てる。
 * 実測: 本物の暗黙知・属人化は 0.85〜0.95（「ケースバイケース」「田中さんにしか」）。
 * 条件文「与信がOKなら…」が 0.60〜0.62 で誤検出されたので 0.6 → 0.7 に上げた。
 * サンプルが少ないので、実際の会議データで見直すこと。
 */
export const FLAG_MIN = 0.7;

/** gemma のステップ名を採用する faithful(noul) の下限。未満なら発話の先頭に戻す */
export const FAITHFUL_MIN = 0.6;
/** readable(score 0..4) がこれ未満なら、gemma に 1 度だけ作り直させる */
export const READABLE_MIN = 2.0;
/** ステップ名の生成の最大回数（初回を含む） */
export const MAX_LABEL_ATTEMPTS = 2;
/** new_actor_dup の choice がこれ以上の confidence で「既存と同じ」なら統合する */
export const ACTOR_DUP_MIN = 0.5;
/** 新しく見つけたアクターを含むステップの確信度の上限（検証が済むまでは仮） */
export const NEW_ACTOR_CONFIDENCE = 0.6;

/** branch_marker(noul) がこれ以上なら、gemma に場合分けの有無を考えさせる */
export const BRANCH_HINT_MIN = 0.5;

/** noul に confidence が無いので 0.5 からの距離で代用する */
export const noulConfidence = (p: number): number => Math.abs(p - 0.5) * 2;

/** ステップ名の暫定文（gemma が入るまで）の最大文字数 */
export const FALLBACK_LABEL_CHARS = 24;
