import { notesOn, noteState } from "../model/notes";
import type { Actor, FlowModel, Step } from "../model/types";
import { visibleSteps } from "../render/mermaid";
import { singlePersonSteps } from "../review/rules";

/**
 * 業務分掌の本体（部署別の責任と権限）と、統制上の確認点を、図のモデルから作る。純関数。
 *
 * 業務分掌は「どの部署が何に責任を持ち、何を判断・承認するか」を定めるもの。流れの説明（業務記述書にあたる部分）は
 * lib/summary/flow-text.ts に任せ、ここでは部署ごとに手順の番号を引いて短くまとめる。
 * 承認・判断・作成は、手順名の言葉から当たりを付ける（確かなことは言えないので、確認点として出す）。
 */

/** 承認・決裁（権限の行使） */
const APPROVE = /(承認|決裁|認可|許可)/;
/** 確認・照合（チェック） */
const CHECK = /(確認|照合|チェック|点検|検査|審査|検収)/;
/** 差し戻し・却下（判断の結果） */
const REJECT = /(差し?戻|却下|否認|返却)/;
/** 作る・登録する（職務分離で、承認と同じ人がやると問題になる側） */
const MAKE = /(作成|作る|登録|入力|起票|計上|発行|修正)/;

export type Duty = {
  actor: Actor;
  /** 受け持つ手順（その部署が送り手の手順）。「名前（番号）」 */
  tasks: string[];
  /** 承認・確認・判断する手順。「承認（14・仮）」のように種類ごとに番号をまとめる */
  decisions: string[];
  received: string[];
  handed: string[];
  systems: string[];
  /** 手順を実際にやる人（「金城（15）」） */
  assignees: string[];
  /** 決まった付箋（決まりごと） */
  rules: string[];
};

const numbered = (model: FlowModel) => visibleSteps(model).map((s, i) => ({ s, no: i + 1 }));
const uniq = (xs: string[]) => [...new Set(xs)];

/** 手順の番号を「3〜5・10」のようにまとめる */
export function numberRange(nos: number[]): string {
  const sorted = [...new Set(nos)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(j - i >= 2 ? `${sorted[i]}〜${sorted[j]}` : sorted.slice(i, j + 1).join("・"));
    i = j;
  }
  return parts.join("・");
}

function decisionOf(s: Step): "承認" | "差し戻しの判断" | "確認" | null {
  if (APPROVE.test(s.label)) return "承認";
  if (REJECT.test(s.label)) return "差し戻しの判断";
  if (CHECK.test(s.label)) return "確認";
  return null;
}

export function dutiesOf(model: FlowModel): Duty[] {
  const list = numbered(model);
  const byId = new Map(model.actors.map((a) => [a.id, a]));
  return model.actors
    .filter((a) => a.kind !== "system")
    .sort((x, y) => x.lane - y.lane)
    .map((actor) => {
      const own = list.filter(({ s }) => s.from === actor.id);
      const tentative = (s: Step) => (s.status === "provisional" ? "・仮" : "");
      const assignees = new Map<string, number[]>();
      for (const { s, no } of own) if (s.assignee) assignees.set(s.assignee, [...(assignees.get(s.assignee) ?? []), no]);
      return {
        actor,
        tasks: own.map(({ s, no }) => `${s.label.trim()}（${no}${tentative(s)}）`),
        decisions: (["承認", "差し戻しの判断", "確認"] as const).flatMap((kind) => {
          const hit = own.filter(({ s }) => decisionOf(s) === kind);
          if (hit.length === 0) return [];
          const tent = hit.some(({ s }) => s.status === "provisional") ? "・仮を含む" : "";
          return [`${kind}（${numberRange(hit.map(({ no }) => no))}${tent}）`];
        }),
        received: uniq(
          list.filter(({ s }) => s.to === actor.id && s.from !== actor.id && s.artifact?.trim()).map(({ s }) => s.artifact!.trim()),
        ),
        handed: uniq(own.filter(({ s }) => s.artifact?.trim()).map(({ s }) => s.artifact!.trim())),
        systems: uniq(
          list
            .flatMap(({ s }) => (s.from === actor.id ? [s.to] : s.to === actor.id ? [s.from] : []))
            .map((id) => byId.get(id))
            .filter((x): x is Actor => x?.kind === "system")
            .map((x) => (x.product ? `${x.name}（${x.product}）` : x.name)),
        ),
        assignees: [...assignees].map(([who, nos]) => `${who}（${numberRange(nos)}）`),
        rules: notesOn(model, { kind: "actor", id: actor.id })
          .filter((n) => noteState(n) === "answered")
          .map((n) => `${n.prompt?.text ?? n.question} → ${n.answer ?? ""}`),
      };
    })
    .filter((d) => d.tasks.length > 0 || d.received.length > 0);
}

/** 統制上の確認点。図から言えることだけを、確認を促す文で出す */
export function controlPoints(model: FlowModel): string[] {
  const list = numbered(model);
  const out: string[] = [];
  const holders = model.actors.filter((a) => a.kind !== "system");

  // 職務分離: 同じ部署（担当者が分かれていると書かれていない）が、作る・登録する手順と承認する手順の両方を持つ
  for (const a of holders) {
    const own = list.filter(({ s }) => s.from === a.id);
    const approve = own.filter(({ s }) => APPROVE.test(s.label));
    const make = own.filter(({ s }) => MAKE.test(s.label) && !APPROVE.test(s.label));
    if (approve.length === 0 || make.length === 0) continue;
    const people = (xs: typeof own) => new Set(xs.map(({ s }) => s.assignee).filter(Boolean));
    const ap = people(approve);
    const mk = people(make);
    const separated = ap.size > 0 && mk.size > 0 && [...ap].every((p) => !mk.has(p));
    if (separated) continue;
    out.push(
      `**職務分離**: ${a.name}が、作成・登録（${numberRange(make.map((x) => x.no))}）と承認（${numberRange(approve.map((x) => x.no))}）の両方を行っています。作る人と承認する人を分けているか確認してください。`,
    );
  }

  // 承認の手順が 1 つも無い
  if (list.length > 0 && !list.some(({ s }) => APPROVE.test(s.label))) {
    out.push("**承認**: 承認・決裁の手順がありません。誰が最終的に責任を持つのか（承認者）を確認してください。");
  }

  // 差し戻しの判断に、基準が決まっていない（判断した手順・前の手順の付箋が未決）
  for (const { s, no } of list.filter(({ s }) => REJECT.test(s.label))) {
    const open = notesOn(model, { kind: "step", id: s.id }).some((n) => noteState(n) === "open");
    if (open) out.push(`**判断の基準**: 差し戻しの判断（${no}）の基準が、まだ決まっていません。`);
  }

  // 属人化: 部署の手順を 1 人だけが担っている／［属人］の印
  for (const a of holders) {
    const single = singlePersonSteps(model, a.id);
    if (single) {
      const nos = single.steps.map((s) => list.find((x) => x.s.id === s.id)?.no ?? 0);
      out.push(`**属人化**: ${a.name}の手順（${numberRange(nos)}）を${single.who}さん 1 人が担っています。代わりの人や手順書があるか確認してください。`);
    }
  }
  const flagged = (key: keyof Step["flags"]) => list.filter(({ s }) => s.flags[key]).map(({ no }) => no);
  const pd = flagged("personDependent");
  if (pd.length > 0) out.push(`**属人化**: 特定の人にしかできない手順があります（${numberRange(pd)}）。`);
  const ex = flagged("exception");
  if (ex.length > 0) out.push(`**例外**: 例外的な対応の手順があります（${numberRange(ex)}）。誰が判断して対応するかを決めておいてください。`);
  const tc = flagged("tacit");
  if (tc.length > 0) out.push(`**暗黙知**: 手順書に無いやり方に頼っている手順があります（${numberRange(tc)}）。`);
  const pv = list.filter(({ s }) => s.status === "provisional").map(({ no }) => no);
  if (pv.length > 0) out.push(`**仮の手順**: まだ確かではない手順があります（${numberRange(pv)}）。`);
  return out;
}

export type Raci = "A" | "R" | "C" | "I";
export type RaciTable = { columns: string[]; rows: { label: string; cells: (Raci | "")[] }[] };

/**
 * 責任分担表（RACI）: 業務のまとまり × 部署。図から言える範囲で当てる。
 * A = そのまとまりで承認する（承認・決裁の手順の送り手）/ R = 手順を行う（送り手）/
 * C = 依頼を受けて返す（依頼の受け手・返答の送り手）/ I = 受け取るだけ。強い順に 1 つだけ書く
 */
export function raciTable(model: FlowModel, blocks: { label: string; stepIds: string[] }[]): RaciTable {
  const stepById = new Map(model.steps.map((s) => [s.id, s]));
  const holders = model.actors.filter((a) => a.kind !== "system").sort((x, y) => x.lane - y.lane);
  const rank: Record<Raci, number> = { A: 3, R: 2, C: 1, I: 0 };
  const rows = blocks.map((b) => {
    const steps = b.stepIds.flatMap((id) => stepById.get(id) ?? []);
    const cells = holders.map((a): Raci | "" => {
      let best: Raci | "" = "";
      const put = (r: Raci) => {
        if (best === "" || rank[r] > rank[best]) best = r;
      };
      for (const s of steps) {
        if (s.from === a.id) put(APPROVE.test(s.label) ? "A" : s.kind === "reply" ? "C" : "R");
        else if (s.to === a.id) put(s.kind === "sync" ? "C" : "I");
      }
      return best;
    });
    return { label: b.label, cells };
  });
  // どのまとまりにも出てこない部署の列は出さない
  const used = holders.map((_, i) => rows.some((r) => r.cells[i] !== ""));
  return {
    columns: holders.filter((_, i) => used[i]).map((a) => a.name),
    rows: rows.map((r) => ({ label: r.label, cells: r.cells.filter((_, i) => used[i]) })),
  };
}
