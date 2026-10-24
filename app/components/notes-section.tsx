"use client";

import { useState } from "react";
import { addNoteOp, answerNoteOp, noteState, notesOn, type NoteTarget } from "@/lib/model/notes";
import type { FlowModel, ModelOp, OpenIssue } from "@/lib/model/types";

const TEXT: Record<NoteTarget["kind"], { title: string; placeholder: string; hint: string }> = {
  step: {
    title: "付箋（チームで決めること）",
    placeholder: "例: 何があれば「不備あり」とするか",
    hint: "判断の基準など、図の流れとは別に決めておくことを書きます。まだ決まっていない付箋は、次の会議で AI が聞きます。",
  },
  frame: {
    title: "枠の付箋",
    placeholder: "例: どの場合に当てはまるかを、何で見分けるか",
    hint: "分岐の見分け方・くり返しを終える基準など、枠全体について決めておくことを書きます。",
  },
  actor: {
    title: "付箋",
    placeholder: "例: 不在のときは誰が代わるか",
    hint: "この人・部署・システムについて決めておくこと（代わりの人・使う時間帯など）を書きます。",
  },
};

const field = "w-full min-w-0 rounded-md border border-black/15 bg-transparent px-3 py-1.5 text-sm dark:border-white/20";
const btn =
  "shrink-0 rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-black/5 disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/10";

/**
 * 手順・枠・登場人物に貼る付箋（チームで決めること）の欄。答えを書くと「決まりごと」になる。
 * 付箋は論点として残るので、まだ決まっていないものは次の会議で AI が聞く（lib/model/notes.ts）。
 * `inline` なら見出しを小さくし、ほかの欄（分岐の欄・登場人物の設定）の中に置けるようにする
 */
export function NotesSection({
  model,
  target,
  onCommit,
  inline = false,
}: {
  model: FlowModel;
  target: NoteTarget;
  onCommit: (ops: ModelOp[]) => void;
  inline?: boolean;
}) {
  const notes = notesOn(model, target);
  const [question, setQuestion] = useState("");
  const text = TEXT[target.kind];
  const add = () => {
    // 登場人物について決めることは、代わりの人など担当の話が多い。手順・枠は判断の基準
    const op = addNoteOp(model, question, target, target.kind === "actor" ? "who" : "criteria");
    if (!op) return;
    onCommit([op]);
    setQuestion("");
  };
  const title = `${text.title}${notes.length > 0 ? ` ${notes.length} 件` : ""}`;
  return (
    <section className="flex flex-col gap-2">
      <h3 className={inline ? "text-xs text-zinc-500" : "text-xs font-medium text-zinc-500"}>{title}</h3>
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} onCommit={onCommit} />
      ))}
      <div className="flex gap-1.5">
        <input
          className={field}
          value={question}
          placeholder={text.placeholder}
          aria-label={`${text.title}に書く、チームで決めること`}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            // Enter でダイアログ・フォーム全体が送信されないようにする
            e.preventDefault();
            add();
          }}
        />
        <button type="button" className={btn} disabled={question.trim() === ""} onClick={add}>
          貼る
        </button>
      </div>
      {notes.length === 0 && <p className="text-xs text-zinc-500">{text.hint}</p>}
    </section>
  );
}

/** 付箋 1 枚。答え（決まったこと）を書くと「決まりごと」になる。空にすると、まだ決まっていない付箋に戻る */
function NoteCard({ note, onCommit }: { note: OpenIssue; onCommit: (ops: ModelOp[]) => void }) {
  const [draft, setDraft] = useState<{ for: string; text: string } | null>(null);
  const key = `${note.id}:${note.answer ?? ""}`;
  const answer = draft?.for === key ? draft.text : (note.answer ?? "");
  const decided = noteState(note) === "answered";
  const commit = () => {
    setDraft(null);
    const op = answerNoteOp(note, answer);
    if (op) onCommit([op]);
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-[#d4c36a] bg-[#fff9c4] p-2 text-zinc-900 shadow-sm dark:border-amber-300/40 dark:bg-amber-300/10 dark:text-amber-50">
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-0.5 shrink-0 rounded px-1 text-[10px] font-semibold ${
            decided ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"
          }`}
        >
          {decided ? "決まり" : "未決"}
        </span>
        <p className="min-w-0 flex-1 text-xs leading-relaxed">{note.prompt?.text ?? note.question}</p>
        <button
          type="button"
          aria-label="付箋を外す"
          title="付箋を外す"
          className="shrink-0 rounded px-1 text-xs text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => onCommit([{ op: "issue.remove", id: note.id }])}
        >
          ×
        </button>
      </div>
      <textarea
        rows={2}
        className="w-full resize-y rounded-sm border border-black/10 bg-white/70 px-2 py-1 text-xs dark:border-white/15 dark:bg-black/20"
        value={answer}
        placeholder="決まったことを書く（例: 金額・宛名・明細のどれかが違えば不備あり）"
        aria-label="決まったこと"
        onChange={(e) => setDraft({ for: key, text: e.target.value })}
        onBlur={commit}
      />
    </div>
  );
}
