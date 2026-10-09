// podium-express — impact engine (pure, deterministic).
//
// Answers: "what is each pod member's time + communication impact on objectives?"
// Every score ships with its reasons — no black boxes in an executive tool.

import type { PodMember, TimeEntry, PodMessage, Objective } from "./podium";

export interface MemberImpact {
  person_id: string; name: string; role: string;
  allocated_hours: number | null;
  hours_logged: number;            // in the window
  utilization_pct: number | null;  // hours / pro-rata allocation
  messages_sent: number;
  objectives_touched: number;
  score: number;                   // 0–100
  reasons: string[];               // why this score, in plain words
  trend: "up" | "flat" | "down";   // second half of window vs first half
}

export interface PodImpact {
  pod_id: string;
  total_hours: number;
  avg_utilization_pct: number | null;
  messages_total: number;
  objectives_total: number;
  objectives_on_track: number;
  objectives_at_risk: number;
  avg_progress_pct: number | null;
  members: MemberImpact[];
}

const dayMs = 86400000;

function inWindow(dayStr: string, fromMs: number, toMs: number): boolean {
  const t = new Date(dayStr + "T12:00:00Z").getTime();
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

/** Crude but honest: does this time entry's note mention the objective? */
export function touchesObjective(note: string, objectives: Objective[]): number {
  const n = (note || "").toLowerCase();
  if (!n) return 0;
  let hits = 0;
  for (const o of objectives) {
    const words = o.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
    if (words.some((w) => n.includes(w))) hits++;
  }
  return hits;
}

export function memberImpact(
  m: PodMember, entries: TimeEntry[], messages: PodMessage[],
  objectives: Objective[], windowDays: number, nowMs = Date.now(),
): MemberImpact {
  const toMs = nowMs, fromMs = nowMs - windowDays * dayMs;
  const myEntries = entries.filter((e) => e.person_id === m.person_id && inWindow(e.day, fromMs, toMs));
  const hours = myEntries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const myMsgs = messages.filter((x) => x.author_id === m.person_id);
  const objTouched = new Set<string>();
  for (const e of myEntries) for (const o of objectives) {
    if (touchesObjective(e.note, [o]) > 0) objTouched.add(o.id);
  }
  // utilization vs pro-rata monthly allocation
  let utilization: number | null = null;
  if (m.allocated_hours != null && m.allocated_hours > 0) {
    const proRata = (m.allocated_hours * windowDays) / 30;
    utilization = proRata > 0 ? Math.round((hours / proRata) * 100) : null;
  }
  // trend: second half vs first half of the window
  const mid = fromMs + (windowDays * dayMs) / 2;
  const h1 = myEntries.filter((e) => new Date(e.day + "T12:00:00Z").getTime() < mid).reduce((s, e) => s + Number(e.hours || 0), 0);
  const h2 = hours - h1;
  const trend = h2 > h1 * 1.25 ? "up" : h2 < h1 * 0.75 ? "down" : "flat";

  // score: 55% time vs allocation, 25% comms, 20% objective touch. All capped, all explained.
  const reasons: string[] = [];
  let score = 0;
  if (utilization != null) {
    const t = Math.min(100, utilization); // over-allocation doesn't inflate past 100
    score += t * 0.55;
    reasons.push(t >= 80 ? `at ${utilization}% of allocation` : t >= 40 ? `at ${utilization}% of allocation — room to grow` : `only ${utilization}% of allocation so far`);
  } else {
    score += Math.min(100, hours * 4) * 0.55; // no allocation: reward raw hours gently
    reasons.push(hours > 0 ? `${round1(hours)}h logged` : "no hours logged yet");
  }
  const commScore = Math.min(100, myMsgs.length * 6);
  score += commScore * 0.25;
  reasons.push(myMsgs.length === 0 ? "quiet in channels" : `${myMsgs.length} messages`);
  const objScore = objectives.length ? Math.min(100, (objTouched.size / objectives.length) * 100) : 50;
  score += objScore * 0.2;
  if (objectives.length) reasons.push(objTouched.size ? `touched ${objTouched.size}/${objectives.length} objectives` : "no objective-linked work logged");

  return {
    person_id: m.person_id, name: m.person_name || m.person_id, role: m.role || "",
    allocated_hours: m.allocated_hours, hours_logged: round1(hours),
    utilization_pct: utilization, messages_sent: myMsgs.length,
    objectives_touched: objTouched.size, score: Math.round(Math.min(100, score)),
    reasons, trend,
  };
}

export function podImpact(
  podId: string, members: PodMember[], entries: TimeEntry[],
  messages: PodMessage[], objectives: Objective[], windowDays: number, nowMs = Date.now(),
): PodImpact {
  const mis = members.map((m) => memberImpact(m, entries, messages, objectives, windowDays, nowMs));
  const utils = mis.map((m) => m.utilization_pct).filter((u): u is number => u != null);
  const progs = objectives.map((o) => o.progress_pct).filter((p) => Number.isFinite(p));
  return {
    pod_id: podId,
    total_hours: round1(mis.reduce((s, m) => s + m.hours_logged, 0)),
    avg_utilization_pct: utils.length ? Math.round(utils.reduce((a, b) => a + b, 0) / utils.length) : null,
    messages_total: messages.length,
    objectives_total: objectives.length,
    objectives_on_track: objectives.filter((o) => o.status === "on_track").length,
    objectives_at_risk: objectives.filter((o) => o.status === "at_risk").length,
    avg_progress_pct: progs.length ? Math.round(progs.reduce((a, b) => a + b, 0) / progs.length) : null,
    members: mis.sort((a, b) => b.score - a.score),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
