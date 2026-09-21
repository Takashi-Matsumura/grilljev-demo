"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/** 読み終わったあと、マイクを再開するまでの余韻（スピーカーの残響を拾わないため） */
const RESUME_DELAY_MS = 500;
/**
 * 読み上げがこれを超えたら強制的に終える。音声が無い・終了イベントが来ないブラウザで、
 * 「読み上げ中」のままマイクが止まり続けるのを防ぐ安全弁。
 */
const MAX_SPEAK_MS = 30_000;

const subscribeNever = () => () => {};

/**
 * ブラウザ内蔵の音声合成（SpeechSynthesis）で読み上げる。ローカルで完結し、追加の依存は無い。
 * `speaking` は「読み始めから、読み終わり + 余韻」まで true。この間はマイクの入力を無視すること
 * （読み上げの声が文字起こしに混ざるのを防ぐ）。
 */
export function useSpeech() {
  const supported = useSyncExternalStore(
    subscribeNever,
    () => "speechSynthesis" in window,
    () => false,
  );
  const [speaking, setSpeaking] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    if (safetyTimer.current) clearTimeout(safetyTimer.current);
    resumeTimer.current = null;
    safetyTimer.current = null;
  };

  const cancel = useCallback(() => {
    clearTimers();
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window) || text.trim() === "") return;
    clearTimers();
    window.speechSynthesis.cancel(); // 読み上げ中なら切り替える

    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    const ja = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith("ja"));
    if (ja) u.voice = ja;

    const finish = () => {
      clearTimers();
      resumeTimer.current = setTimeout(() => setSpeaking(false), RESUME_DELAY_MS);
    };
    u.onend = finish;
    u.onerror = finish;
    // 読み始める前から入力を止める（最初の音が文字起こしに混ざらないように）
    setSpeaking(true);
    safetyTimer.current = setTimeout(() => {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }, MAX_SPEAK_MS);
    window.speechSynthesis.speak(u);
  }, []);

  useEffect(() => cancel, [cancel]);

  return { supported, speaking, speak, cancel };
}
