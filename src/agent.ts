// podium-express — the embedded agent.
//
// Outpost runs a deterministic triage agent over the inbox; this is the
// pod-level equivalent. It reads the same signals every view reads — time
// vs allocation, comms recency, objective health, important-task pressure —
// and produces two things, both deterministic and explainable:
//
//   runAgent(snap) → { nudges, briefing, generatedAt }
//
// Nudges are soft and never alarming (a test enforces the tone). The
// briefing is the calm morning summary: what's moving, what needs you,
// what's worth celebrating — in that order.

import type { PodSnapshot } from "./channels";
import { podImpact } from "./impact";
import { buildThreads } from "./threads";
import { buildFocus } from "./focus";

export interface Nudge {
  id: string;
  severity: "praise" | "nudge" | "info";
  title: string;
  body: string;
  person_id?: string;
  objective_id?: string;
}

export const MAX_NUDGES = 8;
const DAY = 86400000;

export function generateNudges(snap: PodSnapshot, nowMs = Date.now()): Nudge[] {
  const out: Nudge[] = [];
  const { members, objectives, entries, tasks, messagesByChannel, windowDays } = snap;
  const impact = podImpact(snap.pod.id, members, entries, allMessages(messagesByChannel), objectives, windowDays, nowMs);
  const nameOf = (pid: string) => members.find((m) => m.person_id === pid)?.person_name || pid;

  // --- time vs allocation -------------------------------------------------
  for (const mi of impact.members) {
    if (mi.allocated_hours == null || mi.allocated_hours <= 0) continue;
    const u = mi.utilization_pct ?? 0;
    if (u < 25 && mi.hours_logged < mi.allocated_hours * 0.25) {
      out.push({
        id: `time-low:${mi.person_id}`, severity: "nudge",
        title: `${mi.name} is light on hours`,
        body: `${mi.hours_logged}h of ${mi.allocated_hours}h allocated in the last ${windowDays}d. A quick check-in might unblock them.`,
        person_id: mi.person_id,
      });
    } else if (u >= 110) {
      out.push({
        id: `time-high:${mi.person_id}`, severity: "info",
        title: `${mi.name} is running hot`,
        body: `${u}% of allocation. Watch for burnout — or celebrate the push.`,
        person_id: mi.person_id,
      });
    }
  }

  // --- comms quiet ---------------------------------------------------------
  const threads = buildThreads(messagesByChannel, (pid) => nameOf(pid));
  for (const mi of impact.members) {
    const th = threads.find((t) => t.person_id === mi.person_id);
    const lastMs = th?.last_at ? new Date(th.last_at).getTime() : 0;
    const daysQuiet = lastMs ? Math.floor((nowMs - lastMs) / DAY) : windowDays;
    if (daysQuiet >= 7 && (mi.allocated_hours || 0) > 0) {
      out.push({
        id: `quiet:${mi.person_id}`, severity: "nudge",
        title: `${mi.name} has been quiet`,
        body: `No channel messages in ${daysQuiet}d. Silence isn't always a problem — but it's worth knowing.`,
        person_id: mi.person_id,
      });
    }
  }
  // concentration: one voice dominating the room
  const total = threads.reduce((s, t) => s + t.message_count, 0);
  if (total >= 10) {
    const top = threads[0];
    if (top && top.message_count / total > 0.6) {
      out.push({
        id: "concentration", severity: "info",
        title: "One voice is carrying the room",
        body: `${top.name} sent ${Math.round((top.message_count / total) * 100)}% of recent messages. Consider drawing out quieter members.`,
        person_id: top.person_id,
      });
    }
  }

  // --- objective health ------------------------------------------------------
  for (const o of objectives) {
    if (o.status === "at_risk") {
      out.push({
        id: `risk:${o.id}`, severity: "nudge",
        title: `“${o.title}” is at risk`,
        body: `Marked at risk at ${o.progress_pct}% progress. A nudge to the pod could get it moving again.`,
        objective_id: o.id,
      });
    } else if (o.status === "done") {
      out.push({
        id: `done:${o.id}`, severity: "praise",
        title: `“${o.title}” is done 🎉`,
        body: `100% — worth celebrating with the pod. Wins compound.`,
        objective_id: o.id,
      });
    } else if (o.progress_pct === 0) {
      const ageDays = Math.floor((nowMs - new Date(o.created_at).getTime()) / DAY);
      if (ageDays >= 14) {
        out.push({
          id: `stalled:${o.id}`, severity: "nudge",
          title: `“${o.title}” hasn't started moving`,
          body: `Created ${ageDays}d ago, still at 0%. Even a small first step would help.`,
          objective_id: o.id,
        });
      }
    }
  }

  // --- important-task pressure -------------------------------------------------
  const focus = buildFocus(tasks, objectives, nowMs);
  const overdue = focus.filter((f) => f.overdue && f.kind === "task");
  if (overdue.length) {
    out.push({
      id: "overdue", severity: "nudge",
      title: `${overdue.length} important ${overdue.length === 1 ? "task is" : "tasks are"} overdue`,
      body: overdue.slice(0, 3).map((f) => `“${f.title}”`).join(", ") + ". The busywork stayed out — these matter.",
    });
  }

  // --- praise: high impact ------------------------------------------------------
  for (const mi of impact.members.slice(0, 2)) {
    if (mi.score >= 75 && mi.hours_logged > 0) {
      out.push({
        id: `praise:${mi.person_id}`, severity: "praise",
        title: `${mi.name} is on fire`,
        body: mi.reasons.slice(0, 2).join(" · ") + ". Recognition is cheap and compounds.",
        person_id: mi.person_id,
      });
      break; // one praise per run keeps it meaningful
    }
  }

  const rank = { praise: 0, nudge: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, MAX_NUDGES);
}

function allMessages(messagesByChannel: PodSnapshot["messagesByChannel"]) {
  return messagesByChannel.flatMap(({ messages }) => messages);
}

export interface AgentResult {
  nudges: Nudge[];
  /** Calm morning-summary lines, most important first. */
  briefing: string[];
  generatedAt: string;
}

/**
 * The agent run: nudges plus a short briefing. Same input → same output,
 * every line traceable to a signal. Nothing here guesses.
 */
export function runAgent(snap: PodSnapshot, nowMs = Date.now()): AgentResult {
  const nudges = generateNudges(snap, nowMs);
  const briefing = buildBriefing(snap, nudges, nowMs);
  return { nudges, briefing, generatedAt: new Date(nowMs).toISOString() };
}

function buildBriefing(snap: PodSnapshot, nudges: Nudge[], nowMs: number): string[] {
  const lines: string[] = [];
  const { members, objectives, tasks, messagesByChannel, windowDays } = snap;
  const totalMsgs = messagesByChannel.reduce((s, x) => s + x.messages.length, 0);

  // what's moving
  const done = objectives.filter((o) => o.status === "done").length;
  if (done > 0) lines.push(`${done} objective${done === 1 ? " is" : "s are"} done — worth a moment of recognition.`);
  const active = members.filter((m) =>
    messagesByChannel.some((x) => x.messages.some((msg) => msg.author_id === m.person_id))
  ).length;
  if (members.length > 0) lines.push(`${active} of ${members.length} members spoke up in the last ${windowDays} days${totalMsgs ? ` (${totalMsgs} messages)` : ""}.`);

  // what needs you — surface the sharpest nudges, plainly
  const sharp = nudges.filter((n) => n.severity === "nudge").slice(0, 2);
  for (const n of sharp) lines.push(n.title + ".");

  // what's worth celebrating
  const praise = nudges.find((n) => n.severity === "praise");
  if (praise) lines.push(praise.title + ".");

  if (!lines.length) lines.push("All quiet. The pod is humming.");
  return lines.slice(0, 5);
}
