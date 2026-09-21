/**
 * AudioWorklet のソース。文字列で持ち、Blob URL 経由で addModule する
 * （別エントリを吐かせる bundler 設定が要らなくなる）。
 * 128 サンプルごとの生 PCM をそのままメインスレッドへ渡す。
 */
export const PCM_TAP_SRC = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(new Float32Array(channel));
    return true;
  }
}
registerProcessor("pcm-tap", PcmTap);
`;
