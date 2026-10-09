// podium-express — Podium API client.
//
// THE COMMON-API CONTRACT: podium-express never touches Podium's SQLite file.
// Everything flows through Podium's HTTP REST API (PODIUM_URL, default
// http://127.0.0.1:3025). If Podium is down, podium-express degrades to an
// honest "can't reach Podium" state instead of guessing.

export interface Pod { id: string; name: string; client_name: string; color: string; }
export interface PodMember {
  pod_id: string; person_id: string; role: string; joined_at: string;
  allocated_hours: number | null; person_name?: string; person_email?: string;
}
export interface Person { id: string; name: string; email: string; title: string; }
export interface Channel { id: string; pod_id: string; name: string; created_at: string; }
export interface PodMessage {
  id: string; pod_id: string; channel_id: string; author_id: string;
  author_name?: string; body_md: string; thread_parent_id: string | null; created_at: string;
}
export interface TimeEntry {
  id: string; person_id: string; pod_id: string; day: string; hours: number;
  note: string; person_name?: string; block_type: string;
}
export interface KeyResult { id: string; objective_id: string; title: string; target: string; current: string; }
export interface Objective {
  id: string; pod_id: string; title: string; period: string;
  progress_pct: number; status: string; created_at: string; key_results: KeyResult[];
}
// ClickUp task shape (subset we rely on; everything optional except id/name).
export interface PodTask {
  id: string; name: string; status?: string; due_date?: string | number | null;
  priority?: string | { priority?: string } | null; assignees?: Array<{ id?: string; username?: string }>;
  url?: string; date_updated?: string | number | null;
}

export class PodiumUnreachable extends Error {
  constructor(public causeText: string) { super(`Podium unreachable: ${causeText}`); this.name = "PodiumUnreachable"; }
}

type FetchImpl = typeof fetch;

export function createPodiumClient(baseUrl: string, fetchImpl: FetchImpl = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${base}${path}${qs ? "?" + qs : ""}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetchImpl(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status} on ${path}`);
      return (await r.json()) as T;
    } catch (e: any) {
      if (e instanceof PodiumUnreachable) throw e;
      throw new PodiumUnreachable(String(e?.message || e).slice(0, 140));
    } finally { clearTimeout(t); }
  }

  return {
    baseUrl: base,
    health: () => get<{ ok: boolean }>("/api/status").then((r) => r.ok).catch(() => false),
    pods: () => get<{ pods: Pod[] }>("/api/pods").then((r) => r.pods),
    pod: (id: string) => get<{ pod: Pod; members: PodMember[]; channels: Channel[] }>(`/api/pods/${id}`).then((r) => ({ pod: r.pod, members: r.members, channels: r.channels })),
    members: (podId: string) => get<{ members: PodMember[] }>(`/api/pods/${podId}/members`).then((r) => r.members),
    channels: (podId: string) => get<{ channels: Channel[] }>(`/api/pods/${podId}/channels`).then((r) => r.channels),
    messages: (channelId: string) => get<{ messages: PodMessage[] }>(`/api/channels/${channelId}/messages`).then((r) => r.messages),
    objectives: (podId: string) => get<{ objectives: Objective[] }>(`/api/pods/${podId}/objectives`).then((r) => r.objectives),
    time: (params: { from?: string; to?: string; pod_id?: string; person_id?: string } = {}) =>
      get<{ entries: TimeEntry[] }>("/api/time", Object.fromEntries(Object.entries(params).filter(([, v]) => v != null)) as Record<string, string>).then((r) => r.entries),
    people: () => get<{ people: Person[] }>("/api/people").then((r) => r.people),
    // ClickUp tasks need a token configured in Podium; may legitimately come back empty.
    tasks: (podId: string) => get<{ tasks: PodTask[] }>(`/api/pods/${podId}/tasks`).then((r) => r.tasks || []).catch(() => [] as PodTask[]),
  };
}

export type PodiumClient = ReturnType<typeof createPodiumClient>;

/** Pull everything podium-express needs for one pod, in parallel. Best-effort per leg. */
export async function snapshotPod(client: PodiumClient, podId: string, days = 30) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [podRes, objectives, entries, tasks] = await Promise.all([
    client.pod(podId),
    client.objectives(podId).catch(() => [] as Objective[]),
    client.time({ pod_id: podId, from: iso(from), to: iso(to) }).catch(() => [] as TimeEntry[]),
    client.tasks(podId),
  ]);
  const messagesByChannel = await Promise.all(
    podRes.channels.map((c) => client.messages(c.id).then((m) => ({ channel: c, messages: m })).catch(() => ({ channel: c, messages: [] as PodMessage[] })))
  );
  return {
    pod: podRes.pod, members: podRes.members, channels: podRes.channels,
    objectives, entries, tasks, messagesByChannel,
    windowDays: days, fetchedAt: new Date().toISOString(),
  };
}

export type PodSnapshot = Awaited<ReturnType<typeof snapshotPod>>;
