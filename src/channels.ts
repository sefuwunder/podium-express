// podium-express — Podium data sources behind a Transports interface.
//
// Borrowed from outpost's channels.ts: every external source is a leg on a
// Transports object, and pollPod() orchestrates them into one snapshot.
// Tests inject a fake Transports; the server wires the real Podium client.
// The common-API contract holds: only Podium's HTTP API is ever touched.

import type {
  PodiumClient, Pod, PodMember, Channel, PodMessage,
  TimeEntry, Objective, PodTask,
} from "./podium";

export interface PodiumTransports {
  fetchPods(): Promise<Pod[]>;
  fetchPod(podId: string): Promise<{ pod: Pod; members: PodMember[]; channels: Channel[] }>;
  fetchMessages(channelId: string): Promise<PodMessage[]>;
  fetchObjectives(podId: string): Promise<Objective[]>;
  fetchTime(from: string, to: string, podId: string): Promise<TimeEntry[]>;
  fetchTasks(podId: string): Promise<PodTask[]>;
  /** Best-effort reachability probe. */
  ping(): Promise<boolean>;
}

/** Real transports over the Podium HTTP API. */
export function realTransports(client: PodiumClient): PodiumTransports {
  return {
    fetchPods: () => client.pods(),
    fetchPod: (podId) => client.pod(podId),
    fetchMessages: (channelId) => client.messages(channelId),
    fetchObjectives: (podId) => client.objectives(podId),
    fetchTime: (from, to, podId) => client.time({ from, to, pod_id: podId }),
    fetchTasks: (podId) => client.tasks(podId),
    ping: () => client.health(),
  };
}

export interface PodSnapshot {
  pod: Pod;
  members: PodMember[];
  channels: Channel[];
  objectives: Objective[];
  entries: TimeEntry[];
  tasks: PodTask[];
  messagesByChannel: Array<{ channel: Channel; messages: PodMessage[] }>;
  windowDays: number;
  fetchedAt: string;
}

/**
 * Pull everything podium-express needs for one pod. Every leg is
 * best-effort: a failing leg yields an empty list rather than failing
 * the whole poll — one sick channel must not blind the executive.
 */
export async function pollPod(
  t: PodiumTransports, podId: string, days = 30
): Promise<PodSnapshot> {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [podRes, objectives, entries, tasks] = await Promise.all([
    t.fetchPod(podId),
    t.fetchObjectives(podId).catch(() => [] as Objective[]),
    t.fetchTime(iso(from), iso(to), podId).catch(() => [] as TimeEntry[]),
    t.fetchTasks(podId).catch(() => [] as PodTask[]),
  ]);
  const messagesByChannel = await Promise.all(
    podRes.channels.map((c) =>
      t.fetchMessages(c.id)
        .then((m) => ({ channel: c, messages: m }))
        .catch(() => ({ channel: c, messages: [] as PodMessage[] }))
    )
  );
  return {
    pod: podRes.pod,
    members: podRes.members,
    channels: podRes.channels,
    objectives, entries, tasks, messagesByChannel,
    windowDays: days,
    fetchedAt: new Date().toISOString(),
  };
}
