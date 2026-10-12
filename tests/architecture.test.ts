// channels + store + agent tests — the outpost-shaped refactor.
import { test, expect } from "bun:test";
import { pollPod, type PodiumTransports, type PodSnapshot } from "../src/channels";
import { PodStore } from "../src/store";
import { runAgent } from "../src/agent";

const NOW = new Date("2026-10-12T12:00:00Z").getTime();

function fakeTransports(over: Partial<PodiumTransports> = {}): PodiumTransports {
  return {
    fetchPods: async () => [{ id: "p1", name: "Acme", client_name: "Acme", color: "#fff" }],
    fetchPod: async (podId) => ({
      pod: { id: podId, name: "Acme", client_name: "Acme", color: "#fff" },
      members: [{ pod_id: podId, person_id: "u1", role: "COO", joined_at: "2026-01-01", allocated_hours: 40, person_name: "Ada" }],
      channels: [{ id: "c1", pod_id: podId, name: "general", created_at: "" }],
    }),
    fetchMessages: async () => [
      { id: "m1", pod_id: "p1", channel_id: "c1", author_id: "u1", author_name: "Ada", body_md: "hello world", thread_parent_id: null, created_at: new Date(NOW - 3600000).toISOString() },
    ],
    fetchObjectives: async () => [
      { id: "o1", pod_id: "p1", title: "Launch v2", period: "Q4", progress_pct: 50, status: "on_track", created_at: new Date(NOW - 20 * 86400000).toISOString(), key_results: [] },
    ],
    fetchTime: async () => [
      { id: "e1", person_id: "u1", pod_id: "p1", day: new Date(NOW).toISOString().slice(0, 10), hours: 6, note: "launch planning", block_type: "hours" },
    ],
    fetchTasks: async () => [],
    ping: async () => true,
    ...over,
  };
}

test("pollPod assembles a snapshot from all legs", async () => {
  const snap = await pollPod(fakeTransports(), "p1");
  expect(snap.pod.name).toBe("Acme");
  expect(snap.members.length).toBe(1);
  expect(snap.messagesByChannel.length).toBe(1);
  expect(snap.messagesByChannel[0].messages.length).toBe(1);
  expect(snap.windowDays).toBe(30);
});

test("pollPod is best-effort: one sick leg doesn't fail the poll", async () => {
  const t = fakeTransports({
    fetchMessages: async () => { throw new Error("boom"); },
    fetchTasks: async () => { throw new Error("boom"); },
  });
  const snap = await pollPod(t, "p1");
  expect(snap.messagesByChannel[0].messages).toEqual([]);
  expect(snap.tasks).toEqual([]);
  expect(snap.members.length).toBe(1); // healthy legs still land
});

test("store.refresh builds the unified model", async () => {
  const store = new PodStore();
  const m = await store.refresh("p1", fakeTransports());
  expect(m.podName).toBe("Acme");
  expect(m.threads.length).toBe(1);
  expect(m.threads[0].name).toBe("Ada");
  expect(m.impact.members.length).toBe(1);
  expect(m.objectives.length).toBe(1);
  expect(m.agent.briefing.length).toBeGreaterThan(0);
  expect(store.get("p1")).toBe(m);
});

test("store serves cached model without refetching", async () => {
  let calls = 0;
  const t = fakeTransports({ fetchPod: async (id) => { calls++; return fakeTransports().fetchPod(id); } });
  const store = new PodStore();
  await store.refresh("p1", t);
  expect(calls).toBe(1);
  expect(store.get("p1")).not.toBe(null);
});

test("runAgent returns nudges plus a calm briefing", async () => {
  const snap: PodSnapshot = await pollPod(fakeTransports(), "p1");
  const res = runAgent(snap, NOW);
  expect(Array.isArray(res.nudges)).toBe(true);
  expect(res.nudges.length).toBeLessThanOrEqual(8);
  expect(Array.isArray(res.briefing)).toBe(true);
  expect(res.briefing.length).toBeGreaterThan(0);
  expect(res.briefing.length).toBeLessThanOrEqual(5);
  // deterministic: same input → same output
  const res2 = runAgent(snap, NOW);
  expect(JSON.stringify(res2)).toBe(JSON.stringify(res));
});

test("briefing stays gentle when the pod is quiet", async () => {
  const t = fakeTransports({
    fetchMessages: async () => [],
    fetchTime: async () => [],
    fetchObjectives: async () => [],
  });
  const snap = await pollPod(t, "p1");
  const res = runAgent(snap, NOW);
  expect(res.briefing.some((b) => /quiet|humming/i.test(b))).toBe(true);
});
