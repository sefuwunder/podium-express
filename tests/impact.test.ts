// impact engine tests
import { test, expect } from "bun:test";
import { memberImpact, podImpact, touchesObjective } from "../src/impact";
import type { PodMember, TimeEntry, PodMessage, Objective } from "../src/podium";

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const day = (n: number) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

const member = (over: Partial<PodMember> = {}): PodMember => ({
  pod_id: "p1", person_id: "u1", role: "COO", joined_at: "2026-01-01",
  allocated_hours: 40, person_name: "Ada", ...over,
});
const entry = (over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: "e1", person_id: "u1", pod_id: "p1", day: day(2), hours: 4,
  note: "work", person_name: "Ada", block_type: "hours", ...over,
});
const msg = (over: Partial<PodMessage> = {}): PodMessage => ({
  id: "m1", pod_id: "p1", channel_id: "c1", author_id: "u1",
  body_md: "hello", thread_parent_id: null, created_at: new Date(NOW - 3600000).toISOString(), ...over,
});
const obj = (over: Partial<Objective> = {}): Objective => ({
  id: "o1", pod_id: "p1", title: "Launch v2", period: "Q4",
  progress_pct: 40, status: "on_track", created_at: "2026-09-01", key_results: [], ...over,
});

test("touchesObjective matches title keywords in notes", () => {
  const o = obj({ title: "Launch v2 Rocket" });
  expect(touchesObjective("worked on the launch plan", [o])).toBe(1);
  expect(touchesObjective("random admin stuff", [o])).toBe(0);
  expect(touchesObjective("", [o])).toBe(0);
});

test("utilization is pro-rata over the window", () => {
  // 40h/month allocation, 30d window, 20h logged → 50%
  const entries = [entry({ hours: 20, day: day(5) })];
  const mi = memberImpact(member(), entries, [], [], 30, NOW);
  expect(mi.utilization_pct).toBe(50);
  expect(mi.hours_logged).toBe(20);
});

test("no allocation → null utilization, still scores hours", () => {
  const mi = memberImpact(member({ allocated_hours: null }), [entry({ hours: 8 })], [], [], 30, NOW);
  expect(mi.utilization_pct).toBeNull();
  expect(mi.score).toBeGreaterThan(0);
  expect(mi.reasons.join(" ")).toMatch(/8h logged/);
});

test("quiet member gets low comms, explained", () => {
  const mi = memberImpact(member(), [entry()], [], [], 30, NOW);
  expect(mi.messages_sent).toBe(0);
  expect(mi.reasons.join(" ")).toMatch(/quiet in channels/);
});

test("trend compares halves", () => {
  const up = memberImpact(member(), [entry({ hours: 1, day: day(20) }), entry({ hours: 9, day: day(2) })], [], [], 30, NOW);
  expect(up.trend).toBe("up");
  const down = memberImpact(member(), [entry({ hours: 9, day: day(20) }), entry({ hours: 1, day: day(2) })], [], [], 30, NOW);
  expect(down.trend).toBe("down");
});

test("podImpact aggregates and ranks by score", () => {
  const m2 = member({ person_id: "u2", person_name: "Bo", allocated_hours: 40 });
  const entries = [entry({ person_id: "u1", hours: 20 }), entry({ person_id: "u2", hours: 2, day: day(3) })];
  const pi = podImpact("p1", [member(), m2], entries, [msg()], [obj()], 30, NOW);
  expect(pi.total_hours).toBe(22);
  expect(pi.messages_total).toBe(1);
  expect(pi.objectives_on_track).toBe(1);
  expect(pi.members[0].person_id).toBe("u1"); // higher score first
  expect(pi.avg_progress_pct).toBe(40);
});
