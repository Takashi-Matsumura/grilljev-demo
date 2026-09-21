export const TARGET_RATE = 16_000;

/**
 * 16kHz へ落とす。src が 16kHz なら何もしない。
 * 間引きだけだとエイリアシングで whisper の精度が落ちるので、
 * 出力 1 サンプルあたり入力の該当区間を平均する（箱型ローパス）。
 */
export function resampleTo16k(src: Float32Array, srcRate: number): Float32Array {
  if (srcRate === TARGET_RATE) return src;
  const ratio = srcRate / TARGET_RATE;
  const outLength = Math.floor(src.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(src.length, Math.max(start + 1, Math.ceil((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += src[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** Float32 PCM（-1..1）を 16bit モノラル WAV にする。 */
export function encodeWav(pcm: Float32Array, sampleRate = TARGET_RATE): Blob {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンク長
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < pcm.length; i += 1) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
