// nudge engine tests — rules fire correctly, tone stays soft
import { test, expect } from "bun:test";
import { generateNudges, MAX_NUDGES } from "../src/nudges";
import type { PodSnapshot, PodMember, TimeEntry, PodMessage, Objective, Channel, PodTask } from "../src/podium";

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const day = (n: number) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const member = (over: Partial<PodMember> = {}): PodMember => ({
  pod_id: "p1", person_id: "u1", role: "COO", joined_at: "2026-01-01",
  allocated_hours: 40, person_name: "Ada", ...over,
});
const snap = (over: Partial<PodSnapshot> = {}): PodSnapshot => ({
  pod: { id: "p1", name: "Acme", client_name: "Acme", color: "#fff" },
  members: [member()], channels: [{ id: "c1", pod_id: "p1", name: "general", created_at: "" }] as Channel[],
  objectives: [], entries: [], tasks: [] as PodTask[],
  messagesByChannel: [], windowDays: 30, fetchedAt: new Date(NOW).toISOString(),
  ...over,
});
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "e1", person_id: "u1", pod_id: "p1", day: day(2), hours: 4, note: "x", block_type: "hours", ...over,
});
const msg = (over: Partial<PodMessage> = {}): PodMessage => ({
  id: "m1", pod_id: "p1", channel_id: "c1", author_id: "u1", author_name: "Ada",
  body_md: "hi", thread_parent_id: null, created_at: new Date(NOW - 3600000).toISOString(), ...over,
});
const obj = (over: Partial<Objective> = {}): Objective => ({
  id: "o1", pod_id: "p1", title: "Launch v2", period: "Q4", progress_pct: 40,
  status: "on_track", created_at: new Date(NOW - 20 * 86400000).toISOString(), key_results: [], ...over,
});

test("low hours → soft nudge with the numbers", () => {
  const n = generateNudges(snap({ entries: [entry({ hours: 2 })] }), NOW);
  const t = n.find((x) => x.id === "time-low:u1");
  expect(t).toBeTruthy();
  expect(t!.severity).toBe("nudge");
  expect(t!.body).toMatch(/2h of 40h/);
  expect(t!.body).not.toMatch(/urgent|critical|warning|immediately/i);
});

test("quiet member → nudge", () => {
  const old = new Date(NOW - 10 * 86400000).toISOString();
  const n = generateNudges(snap({
    messagesByChannel: [{ channel: { id: "c1", pod_id: "p1", name: "general", created_at: "" }, messages: [msg({ created_at: old })] }],
  }), NOW);
  expect(n.some((x) => x.id === "quiet:u1")).toBe(true);
});

test("at-risk objective → nudge; done → praise", () => {
  const n = generateNudges(snap({ objectives: [obj({ status: "at_risk" }), obj({ id: "o2", title: "Done thing", status: "done", progress_pct: 100 })] }), NOW);
  expect(n.some((x) => x.id === "risk:o1" && x.severity === "nudge")).toBe(true);
  const p = n.find((x) => x.id === "done:o2");
  expect(p?.severity).toBe("praise");
});

test("stalled objective (0% for 14d+) → nudge", () => {
  const n = generateNudges(snap({ objectives: [obj({ progress_pct: 0 })] }), NOW);
  expect(n.some((x) => x.id === "stalled:o1")).toBe(true);
});

test("overdue important task → nudge naming it", () => {
  const n = generateNudges(snap({
    tasks: [{ id: "t1", name: "Sign the Acme SOW", due_date: new Date(NOW - 86400000).toISOString(), priority: "high" }],
  }), NOW);
  const o = n.find((x) => x.id === "overdue");
  expect(o).toBeTruthy();
  expect(o!.body).toMatch(/Acme SOW/);
});

test("busywork overdue does NOT trigger the overdue nudge", () => {
  const n = generateNudges(snap({
    tasks: [{ id: "t1", name: "weekly sync follow up", due_date: new Date(NOW - 86400000).toISOString() }],
  }), NOW);
  expect(n.some((x) => x.id === "overdue")).toBe(false);
});

test("concentration: one voice >60% → info nudge", () => {
  const msgs = Array.from({ length: 9 }, (_, i) => msg({ id: `a${i}`, author_id: "u1" }))
    .concat([msg({ id: "b0", author_id: "u2", author_name: "Bo" })]);
  const n = generateNudges(snap({
    members: [member(), member({ person_id: "u2", person_name: "Bo" })],
    messagesByChannel: [{ channel: { id: "c1", pod_id: "p1", name: "general", created_at: "" }, messages: msgs }],
  }), NOW);
  expect(n.some((x) => x.id === "concentration")).toBe(true);
});

test("cap + ordering: praise first, max nudges", () => {
  const many = Array.from({ length: 12 }, (_, i) => member({ person_id: `u${i}`, person_name: `P${i}` }));
  const n = generateNudges(snap({ members: many }), NOW);
  expect(n.length).toBeLessThanOrEqual(MAX_NUDGES);
  const rank = { praise: 0, nudge: 1, info: 2 } as const;
  for (let i = 1; i < n.length; i++) expect(rank[n[i].severity]).toBeGreaterThanOrEqual(rank[n[i - 1].severity]);
});

test("tone: no alarming language anywhere", () => {
  const n = generateNudges(snap({
    objectives: [obj({ status: "at_risk" })],
    entries: [entry({ hours: 1 })],
    tasks: [{ id: "t1", name: "Sign SOW", due_date: new Date(NOW - 86400000).toISOString(), priority: "urgent" }],
  }), NOW);
  const all = n.map((x) => x.title + " " + x.body).join(" ");
  expect(all).not.toMatch(/urgent|critical|warning|immediately|failure|disaster|alarm/i);
});
