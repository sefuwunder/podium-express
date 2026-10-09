// threads + focus tests
import { test, expect } from "bun:test";
import { buildThreads, recency } from "../src/threads";
import { scoreTask, buildFocus, FOCUS_BAR } from "../src/focus";
import type { PodMessage, Channel, PodTask, Objective } from "../src/podium";

const NOW = new Date("2026-10-09T12:00:00Z").getTime();
const msg = (over: Partial<PodMessage> = {}): PodMessage => ({
  id: "m" + Math.random().toString(36).slice(2), pod_id: "p1", channel_id: "c1",
  author_id: "u1", body_md: "hello", thread_parent_id: null,
  created_at: new Date(NOW - 3600000).toISOString(), ...over,
});
const ch = (id: string, name: string): Channel => ({ id, pod_id: "p1", name, created_at: "2026-01-01" });
const task = (over: Partial<PodTask> = {}): PodTask => ({ id: "t1", name: "Do a thing", ...over });
const obj = (title = "Launch v2"): Objective => ({
  id: "o1", pod_id: "p1", title, period: "Q4", progress_pct: 30,
  status: "on_track", created_at: "2026-09-01", key_results: [],
});

test("buildThreads condenses channels per person, chronological", () => {
  const threads = buildThreads([
    { channel: ch("c1", "general"), messages: [msg({ author_id: "u1", created_at: new Date(NOW - 7200000).toISOString(), body_md: "first" })] },
    { channel: ch("c2", "wins"), messages: [msg({ author_id: "u1", channel_id: "c2", created_at: new Date(NOW - 3600000).toISOString(), body_md: "second" })] },
    { channel: ch("c1", "general"), messages: [msg({ author_id: "u2", author_name: "Bo", body_md: "hey", created_at: new Date(NOW - 60000).toISOString() })] },
  ], (pid) => (pid === "u1" ? "Ada" : pid));
  expect(threads.length).toBe(2);
  const ada = threads.find((t) => t.person_id === "u1")!;
  expect(ada.message_count).toBe(2);
  expect(ada.channels).toEqual(["general", "wins"]);
  expect(ada.messages[0].body).toBe("first");
  expect(ada.messages[1].body).toBe("second");
  expect(ada.preview).toBe("second");
  // most recently active first
  expect(threads[0].person_id).toBe("u2");
});

test("recency labels", () => {
  expect(recency(null)).toBe("—");
  expect(recency(new Date(NOW - 30 * 60000).toISOString(), NOW)).toBe("30m ago");
  expect(recency(new Date(NOW - 5 * 3600000).toISOString(), NOW)).toBe("5h ago");
  expect(recency(new Date(NOW - 3 * 86400000).toISOString(), NOW)).toBe("3d ago");
});

test("busywork is demoted below the bar", () => {
  const s = scoreTask(task({ name: "Follow up on filing admin sync" }), [], NOW);
  expect(s.score).toBeLessThan(FOCUS_BAR);
  expect(s.reasons.join(" ")).toMatch(/busywork/);
});

test("overdue + high priority + objective tie scores high", () => {
  const s = scoreTask(task({
    name: "Launch v2 investor proposal",
    due_date: new Date(NOW - 86400000).toISOString(),
    priority: "high",
  }), [obj()], NOW);
  expect(s.score).toBeGreaterThanOrEqual(FOCUS_BAR);
  expect(s.overdue).toBe(true);
  expect(s.reasons.join(" ")).toMatch(/overdue/);
  expect(s.reasons.join(" ")).toMatch(/tied to/);
});

test("done tasks score zero", () => {
  const s = scoreTask(task({ name: "Launch the rocket", status: "done" }), [obj()], NOW);
  expect(s.score).toBe(0);
});

test("buildFocus keeps important, drops busywork, adds KRs", () => {
  const items = buildFocus([
    task({ id: "t1", name: "weekly sync follow up" }),
    task({ id: "t2", name: "Sign the Acme SOW", due_date: new Date(NOW + 86400000).toISOString(), priority: "urgent" }),
  ], [{ ...obj(), key_results: [{ id: "k1", objective_id: "o1", title: "10 design partners", target: "10", current: "4", created_at: "" }] }], NOW);
  expect(items.some((i) => i.id === "task:t1")).toBe(false);
  expect(items.some((i) => i.id === "task:t2")).toBe(true);
  expect(items.some((i) => i.id === "kr:k1")).toBe(true);
  // overdue sorts first
  const withOverdue = buildFocus([task({ id: "t9", name: "Fix blocker", due_date: new Date(NOW - 1000).toISOString() })], [], NOW);
  expect(withOverdue[0].id).toBe("task:t9");
});
