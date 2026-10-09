// podium-express — the embedded agent: soft executive nudges.
//
// Deterministic, explainable, never alarming. It reads the same signals the
// Impact / Threads / Focus tabs read — time vs allocation, comms recency,
// objective health, important-task pressure — and phrases what it finds the
// way a thoughtful chief of staff would: gently, with the "why" attached.
//
// Severity: "praise" (celebrate) > "nudge" (worth a look) > "info" (context).
// At most MAX_NUDGES are returned, praise first.

import type { PodSnapshot } from "./podium";
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
