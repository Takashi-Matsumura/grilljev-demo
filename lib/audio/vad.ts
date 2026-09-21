/**
 * RMS ベースの発話区間検出。ブラウザ側で「話し始め〜話し終わり」を切り出す。
 * whisper 側の VAD モデルは未導入なので、境界の判断はここが担う。
 *
 * 採用値（計画 §5）:
 * - ノイズフロア: 最初の 1 秒の RMS 中央値。以後、無音中だけ EMA で追従
 * - 発話開始: rms > max(floor*3, 0.008) が 32ms 連続
 * - 発話終了: rms < floor*1.5 が 700ms 連続（日本語の句間ポーズ ~300ms では切らない）
 * - プリロール 500ms（頭切れ防止）／最小 400ms／最大 12 秒（300ms 重ねて継続）
 */

const CALIBRATION_MS = 1_000;
const MIN_START_RMS = 0.008;
const START_FACTOR = 3;
const END_FACTOR = 1.5;
const START_HOLD_MS = 32;
const END_SILENCE_MS = 700;
const PRE_ROLL_MS = 500;
const TAIL_KEEP_MS = 300;
const MIN_VOICED_MS = 400;
const MIN_FLOOR = 0.001;
const FLOOR_EMA = 0.02;

export type Segment = {
  /** ctx のサンプルレートのままの PCM */
  pcm: Float32Array;
  sampleRate: number;
  durationMs: number;
};

export type SegmenterEvents = {
  onSpeechStart?: () => void;
  onSegment: (segment: Segment) => void;
  /** ブロックごとに呼ばれる。描画側で間引くこと */
  onLevel?: (rms: number, speaking: boolean) => void;
};

function rmsOf(block: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) sum += block[i] * block[i];
  return Math.sqrt(sum / Math.max(1, block.length));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function concat(blocks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const b of blocks) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

export class Segmenter {
  /** サーバが詰まってきたら呼び出し側が縮める（バックプレッシャー） */
  maxSegmentMs = 12_000;

  private readonly sampleRate: number;
  private readonly events: SegmenterEvents;

  private calibrating = true;
  private calibrationMs = 0;
  private calibrationRms: number[] = [];
  private floor = MIN_FLOOR;

  private speaking = false;
  private aboveMs = 0;
  private silenceMs = 0;
  private voicedMs = 0;

  private pre: Float32Array[] = [];
  private preSamples = 0;
  private buf: Float32Array[] = [];
  private bufSamples = 0;

  constructor(sampleRate: number, events: SegmenterEvents) {
    this.sampleRate = sampleRate;
    this.events = events;
  }

  private msToSamples(ms: number): number {
    return Math.round((ms / 1000) * this.sampleRate);
  }

  push(block: Float32Array): void {
    const ms = (block.length / this.sampleRate) * 1000;
    const rms = rmsOf(block);

    if (this.calibrating) {
      this.calibrationRms.push(rms);
      this.calibrationMs += ms;
      this.keepPreRoll(block);
      if (this.calibrationMs >= CALIBRATION_MS) {
        this.floor = Math.max(MIN_FLOOR, median(this.calibrationRms));
        this.calibrating = false;
      }
      this.events.onLevel?.(rms, false);
      return;
    }

    if (!this.speaking) {
      const startThreshold = Math.max(this.floor * START_FACTOR, MIN_START_RMS);
      if (rms < startThreshold) {
        this.floor = Math.max(MIN_FLOOR, this.floor * (1 - FLOOR_EMA) + rms * FLOOR_EMA);
      }
      this.keepPreRoll(block);
      this.aboveMs = rms > startThreshold ? this.aboveMs + ms : 0;
      if (this.aboveMs >= START_HOLD_MS) this.beginSpeech();
      this.events.onLevel?.(rms, this.speaking);
      return;
    }

    this.buf.push(block);
    this.bufSamples += block.length;
    if (rms < this.floor * END_FACTOR) {
      this.silenceMs += ms;
    } else {
      this.silenceMs = 0;
      this.voicedMs += ms;
    }

    const durationMs = (this.bufSamples / this.sampleRate) * 1000;
    if (this.silenceMs >= END_SILENCE_MS) {
      this.finish(false);
    } else if (durationMs >= this.maxSegmentMs) {
      this.finish(true);
    }
    this.events.onLevel?.(rms, this.speaking);
  }

  /** 停止時に呼ぶ。話している途中なら、そこまでを 1 セグメントとして出す。 */
  flush(): void {
    if (this.speaking) this.finish(false);
  }

  /**
   * 途中の発話を捨てて待機に戻す（出力はしない）。読み上げ中は入力を無視するので、
   * その直前まで溜めた音（読み上げの頭が混ざりうる）を文字起こしに回さないために使う。
   * 環境音の計測結果（ノイズフロア）は残す。
   */
  reset(): void {
    this.speaking = false;
    this.aboveMs = 0;
    this.silenceMs = 0;
    this.voicedMs = 0;
    this.buf = [];
    this.bufSamples = 0;
    this.pre = [];
    this.preSamples = 0;
  }

  private keepPreRoll(block: Float32Array): void {
    this.pre.push(block);
    this.preSamples += block.length;
    const limit = this.msToSamples(PRE_ROLL_MS);
    while (this.pre.length > 1 && this.preSamples - this.pre[0].length >= limit) {
      this.preSamples -= this.pre[0].length;
      this.pre.shift();
    }
  }

  private beginSpeech(): void {
    this.speaking = true;
    this.buf = this.pre;
    this.bufSamples = this.preSamples;
    this.pre = [];
    this.preSamples = 0;
    this.voicedMs = this.aboveMs;
    this.silenceMs = 0;
    this.events.onSpeechStart?.();
  }

  private finish(forced: boolean): void {
    let pcm = concat(this.buf, this.bufSamples);

    // 末尾の無音は 300ms だけ残して落とす（whisper に無音を食わせない）
    const trimSamples = this.msToSamples(Math.max(0, this.silenceMs - TAIL_KEEP_MS));
    if (trimSamples > 0 && trimSamples < pcm.length) {
      pcm = pcm.subarray(0, pcm.length - trimSamples);
    }

    if (this.voicedMs >= MIN_VOICED_MS) {
      this.events.onSegment({
        pcm,
        sampleRate: this.sampleRate,
        durationMs: (pcm.length / this.sampleRate) * 1000,
      });
    }

    if (forced) {
      // 12 秒で強制的に切る場合、直後の語頭が欠けないよう末尾 300ms を重ねて続ける
      const tail = pcm.subarray(Math.max(0, pcm.length - this.msToSamples(TAIL_KEEP_MS)));
      this.buf = [tail];
      this.bufSamples = tail.length;
      this.voicedMs = 0;
      this.silenceMs = 0;
      return;
    }

    this.speaking = false;
    this.buf = [];
    this.bufSamples = 0;
    this.aboveMs = 0;
    this.silenceMs = 0;
    this.voicedMs = 0;
  }
}
