"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Segmenter, type Segment } from "./vad";
import { PCM_TAP_SRC } from "./worklet-src";

export type RecorderState = "idle" | "starting" | "recording";

type Options = {
  /** 発話 1 区間が確定するたびに呼ばれる */
  onSegment: (segment: Segment) => void;
};

const LEVEL_UPDATE_MS = 80;

function describeError(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === "NotAllowedError") return "マイクの使用が許可されていません（ブラウザの設定を確認）";
    if (e.name === "NotFoundError") return "マイクが見つかりません";
    if (e.name === "NotReadableError") return "マイクが他のアプリで使用中です";
  }
  return e instanceof Error ? e.message : "マイクを開始できませんでした";
}

type Session = {
  stream: MediaStream;
  ctx: AudioContext;
  node: AudioWorkletNode;
  segmenter: Segmenter;
};

export function useRecorder({ onSegment }: Options) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleRate, setSampleRate] = useState<number | null>(null);

  const sessionRef = useRef<Session | null>(null);
  /** true の間は入力を捨てる（読み上げ中のエコー対策）。マイク自体は開いたまま */
  const pausedRef = useRef(false);
  const onSegmentRef = useRef(onSegment);
  const lastLevelAtRef = useRef(0);

  useEffect(() => {
    onSegmentRef.current = onSegment;
  });

  const teardown = useCallback(() => {
    const session = sessionRef.current;
    sessionRef.current = null;
    if (!session) return;
    session.node.port.onmessage = null;
    session.node.disconnect();
    for (const track of session.stream.getTracks()) track.stop();
    void session.ctx.close().catch(() => {});
  }, []);

  const stop = useCallback(() => {
    // 話している途中で止めても、そこまでの発話は失わない
    sessionRef.current?.segmenter.flush();
    teardown();
    setState("idle");
    setLevel(0);
    setSpeaking(false);
  }, [teardown]);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setState("starting");

    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 16kHz を直接要求する。通らない環境は既定レートで開き、確定時に落とす。
      try {
        ctx = new AudioContext({ sampleRate: 16_000 });
      } catch {
        ctx = new AudioContext();
      }
      if (ctx.state === "suspended") await ctx.resume();

      const url = URL.createObjectURL(new Blob([PCM_TAP_SRC], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      const segmenter = new Segmenter(ctx.sampleRate, {
        onSpeechStart: () => setSpeaking(true),
        onSegment: (segment) => {
          setSpeaking(false);
          onSegmentRef.current(segment);
        },
        onLevel: (rms, isSpeaking) => {
          const now = performance.now();
          if (now - lastLevelAtRef.current < LEVEL_UPDATE_MS) return;
          lastLevelAtRef.current = now;
          setLevel(Math.min(1, rms * 8));
          setSpeaking(isSpeaking);
        },
      });

      const source = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "pcm-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!pausedRef.current) segmenter.push(e.data);
      };

      // 出力先に繋がないと処理されない実装があるので、無音ゲイン経由で繋ぐ（自分の声は流さない）
      const mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);

      sessionRef.current = { stream, ctx, node, segmenter };
      setSampleRate(ctx.sampleRate);
      setState("recording");
    } catch (e) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (ctx) void ctx.close().catch(() => {});
      setError(describeError(e));
      setState("idle");
    }
  }, []);

  /** 読み上げ中など、マイクの入力を一時的に無視する。再開時は待機状態から始める。 */
  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
    if (paused) {
      sessionRef.current?.segmenter.reset();
      setSpeaking(false);
    }
  }, []);

  /** サーバが詰まってきたら短くして追従する */
  const setMaxSegmentMs = useCallback((ms: number) => {
    const session = sessionRef.current;
    if (session) session.segmenter.maxSegmentMs = ms;
  }, []);

  useEffect(() => teardown, [teardown]);

  return { state, level, speaking, error, sampleRate, start, stop, setMaxSegmentMs, setPaused };
}
