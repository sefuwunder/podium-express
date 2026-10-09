// podium-express server tests — a stub Podium HTTP server stands in for the real one.
import { test, expect, beforeAll, afterAll } from "bun:test";

const PORT = 32199;
const STUB_PORT = 32198;
const PODIUM = `http://127.0.0.1:${STUB_PORT}`;

const pods = [{ id: "p1", name: "Acme", client_name: "Acme", color: "#fff" }];
const members = [{ pod_id: "p1", person_id: "u1", role: "COO", joined_at: "2026-01-01", allocated_hours: 40, person_name: "Ada" }];
const channels = [{ id: "c1", pod_id: "p1", name: "general", created_at: "" }];
const messages = [{ id: "m1", pod_id: "p1", channel_id: "c1", author_id: "u1", author_name: "Ada", body_md: "hello world", thread_parent_id: null, created_at: new Date().toISOString() }];
const objectives = [{ id: "o1", pod_id: "p1", title: "Launch v2", period: "Q4", progress_pct: 50, status: "on_track", created_at: new Date(Date.now() - 20 * 86400000).toISOString(), key_results: [] }];
const entries = [{ id: "e1", person_id: "u1", pod_id: "p1", day: new Date().toISOString().slice(0, 10), hours: 6, note: "launch planning", block_type: "hours" }];
const tasks = [{ id: "t1", name: "Sign the Acme SOW", due_date: new Date(Date.now() - 86400000).toISOString(), priority: "high" }];

function stubPodium() {
  return Bun.serve({
    port: STUB_PORT, hostname: "127.0.0.1",
    fetch(req) {
      const u = new URL(req.url);
      const p = u.pathname;
      const j = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
      if (p === "/api/status") return j({ ok: true });
      if (p === "/api/pods") return j({ pods });
      if (p === "/api/pods/p1") return j({ pod: pods[0], members, channels });
      if (p === "/api/pods/p1/members") return j({ members });
      if (p === "/api/pods/p1/channels") return j({ channels });
      if (p === "/api/channels/c1/messages") return j({ messages });
      if (p === "/api/pods/p1/objectives") return j({ objectives });
      if (p === "/api/time") return j({ entries });
      if (p === "/api/pods/p1/tasks") return j({ tasks });
      return j({ error: "unstubbed: " + p }, );
    },
  });
}

let stub: any, proc: any;
beforeAll(async () => {
  stub = stubPodium();
  proc = Bun.spawn(["bun", "src/server.ts"], {
    cwd: new URL("../", import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), PODIUM_URL: PODIUM },
    stdout: "ignore", stderr: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/x/health`); if (r.ok) break; } catch {}
    await Bun.sleep(100);
  }
});
afterAll(() => { try { proc?.kill(); } catch {} try { stub?.stop(); } catch {} });

const get = (p: string) => fetch(`http://127.0.0.1:${PORT}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }));

test("health reports podium reachability", async () => {
  const { body } = await get("/api/x/health");
  expect(body.podium_ok).toBe(true);
  expect(body.podium_url).toBe(PODIUM);
});

test("impact aggregates members with scores", async () => {
  const { body } = await get("/api/x/impact?pod_id=p1");
  expect(body.impact.members.length).toBe(1);
  expect(body.impact.members[0].name).toBe("Ada");
  expect(body.impact.total_hours).toBe(6);
  expect(body.impact.members[0].score).toBeGreaterThan(0);
});

test("threads condense per person", async () => {
  const { body } = await get("/api/x/threads?pod_id=p1");
  expect(body.threads.length).toBe(1);
  expect(body.threads[0].preview).toBe("hello world");
});

test("focus surfaces important, drops busywork", async () => {
  const { body } = await get("/api/x/focus?pod_id=p1");
  expect(body.focus.some((f: any) => f.title.includes("Acme SOW"))).toBe(true);
});

test("nudges generate softly", async () => {
  const { body } = await get("/api/x/nudges?pod_id=p1");
  expect(Array.isArray(body.nudges)).toBe(true);
  expect(body.nudges.length).toBeLessThanOrEqual(8);
});

test("objectives passthrough", async () => {
  const { body } = await get("/api/x/objectives?pod_id=p1");
  expect(body.objectives[0].title).toBe("Launch v2");
});

test("missing pod_id → 400", async () => {
  const { status } = await get("/api/x/impact");
  expect(status).toBe(400);
});

test("podium down → honest 502", async () => {
  const p2 = 32200;
  const proc2 = Bun.spawn(["bun", "src/server.ts"], {
    cwd: new URL("../", import.meta.url).pathname,
    env: { ...process.env, PORT: String(p2), PODIUM_URL: "http://127.0.0.1:59999" },
    stdout: "ignore", stderr: "ignore",
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch(`http://127.0.0.1:${p2}/api/x/health`); if (r.ok) break; } catch {}
      await Bun.sleep(100);
    }
    const r = await fetch(`http://127.0.0.1:${p2}/api/x/impact?pod_id=p1`);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("podium_unreachable");
  } finally { try { proc2.kill(); } catch {} }
});
