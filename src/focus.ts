// podium-express — Focus: only important tasks reach the executive.
//
// Every candidate gets an importance score (0–100) with plain-word reasons.
// Busywork — generic low-signal chores with no due date, no priority and no
// tie to an objective — scores under the bar and stays out of the view.
// Key results are objective-linked by construction, so they always qualify.

import type { PodTask, Objective, KeyResult } from "./podium";

export interface FocusItem {
  id: string;
  kind: "task" | "key_result";
  title: string;
  score: number;
  reasons: string[];
  due?: string | null;
  overdue: boolean;
  status?: string;
  url?: string;
  objective_title?: string;
}

export const FOCUS_BAR = 40;

// Busywork tells: routine, low-leverage chores an executive should never see.
const BUSYWORK_RES = [
  /\b(follow[ -]?up|touch base|check[ -]?in|circle back|ping)\b/i,
  /\b(admin|paperwork|filing|file (this|those|it)|organize|tidy|clean ?up)\b/i,
  /\b(sync|standup|stand-up|watercooler|water cooler)\b/i,
  /\b(schedule|reschedule|calendar invite)\b/i,
];
const IMPORTANT_RES = [
  /\b(launch|release|ship|deadline|contract|sow|proposal|board|investor|revenue|churn|risk|blocker|blocked|escalat)\b/i,
];

function dueInfo(t: PodTask, nowMs: number): { due: string | null; overdue: boolean; daysOut: number | null } {
  const raw = t.due_date;
  let ms: number | null = null;
  if (typeof raw === "number") ms = raw > 1e12 ? raw : raw * 1000;
  else if (typeof raw === "string" && raw) { const p = Date.parse(raw); ms = Number.isFinite(p) ? p : null; }
  if (ms == null) return { due: null, overdue: false, daysOut: null };
  const daysOut = Math.ceil((ms - nowMs) / 86400000);
  return { due: new Date(ms).toISOString().slice(0, 10), overdue: daysOut < 0, daysOut };
}

function priorityOf(t: PodTask): string {
  const p = t.priority;
  if (!p) return "";
  return (typeof p === "string" ? p : p.priority || "").toLowerCase();
}

/** Objective keyword hits in the task name — the strongest importance signal. */
function objectiveHits(name: string, objectives: Objective[]): Objective[] {
  const n = name.toLowerCase();
  return objectives.filter((o) => {
    const words = o.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    return words.length > 0 && words.some((w) => n.includes(w));
  });
}

export function scoreTask(t: PodTask, objectives: Objective[], nowMs = Date.now()): FocusItem {
  const reasons: string[] = [];
  let score = 30; // every real task starts with a pulse
  const name = t.name || "(untitled)";
  const status = (t.status || "").toLowerCase();

  const { due, overdue, daysOut } = dueInfo(t, nowMs);
  if (overdue) { score += 30; reasons.push("overdue"); }
  else if (daysOut != null && daysOut <= 3) { score += 20; reasons.push(daysOut === 0 ? "due today" : `due in ${daysOut}d`); }
  else if (due) { score += 10; reasons.push("has a due date"); }

  const pri = priorityOf(t);
  if (/(urgent|high|p1)/.test(pri)) { score += 25; reasons.push("high priority"); }
  else if (/normal|medium/.test(pri)) { score += 8; }

  const objs = objectiveHits(name, objectives);
  if (objs.length) { score += 20; reasons.push(`tied to “${objs[0].title}”`); }

  if (IMPORTANT_RES.some((re) => re.test(name))) { score += 12; reasons.push("high-stakes topic"); }
  if (t.assignees && t.assignees.length) { score += 5; reasons.push("assigned"); }

  const busy = BUSYWORK_RES.some((re) => re.test(name));
  if (busy) { score -= 25; reasons.push("looks like busywork"); }
  if (!due && !pri) { score -= 10; reasons.push("no due date or priority"); }
  if (/^(complete|done|closed|archived)/.test(status)) { score = 0; reasons.push("already done"); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    id: `task:${t.id}`, kind: "task", title: name, score, reasons,
    due, overdue, status: t.status || undefined, url: t.url,
    objective_title: objs[0]?.title,
  };
}

export function keyResultItem(kr: KeyResult, objective: Objective): FocusItem {
  return {
    id: `kr:${kr.id}`, kind: "key_result",
    title: `${objective.title} — ${kr.title}`,
    score: 75,
    reasons: ["key result", `target ${kr.target}`, `now ${kr.current}`],
    overdue: false, objective_title: objective.title,
  };
}

export function buildFocus(tasks: PodTask[], objectives: Objective[], nowMs = Date.now()): FocusItem[] {
  const items: FocusItem[] = [];
  for (const t of tasks) {
    const s = scoreTask(t, objectives, nowMs);
    if (s.score >= FOCUS_BAR) items.push(s);
  }
  for (const o of objectives) {
    if (o.status === "done") continue;
    for (const kr of o.key_results || []) items.push(keyResultItem(kr, o));
  }
  // overdue first, then score
  items.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.score - a.score);
  return items;
}
