// podium-express — the unified in-memory model.
//
// Outpost keeps conversations, triage and agent output in SQLite; the
// common-API contract forbids podium-express from touching Podium's
// database, so the unified model lives here instead: one PodModel per pod,
// rebuilt by refresh() from a pollPod() snapshot. Views never fetch —
// they read the model. The server's sweep() keeps it warm in the
// background, so the UI answers instantly.

import type { PodiumTransports, PodSnapshot } from "./channels";
import type { Objective } from "./podium";
import { buildThreads, type PersonThread } from "./threads";
import { podImpact, type PodImpact } from "./impact";
import { buildFocus, type FocusItem } from "./focus";
import { runAgent, type AgentResult } from "./agent";

export interface PodModel {
  podId: string;
  podName: string;
  windowDays: number;
  fetchedAt: string;
  threads: PersonThread[];
  impact: PodImpact;
  focus: FocusItem[];
  agent: AgentResult;
  objectives: Objective[];
  counts: { members: number; messages: number; objectives: number; tasks: number };
}

function buildModel(podId: string, snap: PodSnapshot): PodModel {
  const nameOf = (pid: string, fallback?: string) =>
    snap.members.find((m) => m.person_id === pid)?.person_name || fallback || pid;
  const threads = buildThreads(snap.messagesByChannel, nameOf);
  const allMessages = snap.messagesByChannel.flatMap((x) => x.messages);
  const impact = podImpact(snap.pod.id, snap.members, snap.entries, allMessages, snap.objectives, snap.windowDays);
  const focus = buildFocus(snap.tasks, snap.objectives);
  const agent = runAgent(snap);
  return {
    podId,
    podName: snap.pod.name,
    windowDays: snap.windowDays,
    fetchedAt: snap.fetchedAt,
    threads, impact, focus, agent,
    objectives: snap.objectives,
    counts: {
      members: snap.members.length,
      messages: allMessages.length,
      objectives: snap.objectives.length,
      tasks: snap.tasks.length,
    },
  };
}

export class PodStore {
  private models = new Map<string, PodModel>();
  private refreshing = new Set<string>();

  get(podId: string): PodModel | null {
    return this.models.get(podId) || null;
  }

  podIds(): string[] {
    return [...this.models.keys()];
  }

  /** Rebuild the model for one pod. Never overlapping per pod. */
  async refresh(podId: string, t: PodiumTransports, days = 30): Promise<PodModel> {
    if (this.refreshing.has(podId)) {
      // A refresh is already in flight — wait for it instead of doubling up.
      for (let i = 0; i < 100 && this.refreshing.has(podId); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const existing = this.models.get(podId);
      if (existing) return existing;
    }
    this.refreshing.add(podId);
    try {
      const { pollPod } = await import("./channels");
      const snap = await pollPod(t, podId, days);
      const model = buildModel(podId, snap);
      this.models.set(podId, model);
      return model;
    } finally {
      this.refreshing.delete(podId);
    }
  }

  invalidate(podId?: string) {
    if (podId) this.models.delete(podId);
    else this.models.clear();
  }
}
