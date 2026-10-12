// podium-express — the executive lens on Podium pods.
//
// Outpost-shaped server: a Transports abstraction over Podium's HTTP API,
// a unified in-memory PodModel per pod, and a background sweep() that
// keeps the models warm — the UI reads the model, never the network.
// The common-API contract holds: Podium's database is never touched.

import { createPodiumClient, PodiumUnreachable } from "./podium";
import { realTransports } from "./channels";
import { PodStore } from "./store";

const PORT = Number(process.env.PORT || 3027);
const PODIUM_URL = process.env.PODIUM_URL || "http://127.0.0.1:3025";
const root = new URL("../public/", import.meta.url).pathname;

const client = createPodiumClient(PODIUM_URL);
const transports = realTransports(client);
const store = new PodStore();

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

const needPod = (url: URL) => {
  const podId = url.searchParams.get("pod_id");
  if (!podId) throw Object.assign(new Error("pod_id required"), { status: 400 });
  return podId;
};

/** Model for a pod, refreshing in the background when stale or missing. */
async function modelFor(podId: string) {
  const cached = store.get(podId);
  if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < 60_000) return cached;
  return store.refresh(podId, transports);
}

// ---------- background sweep (outpost pattern: best-effort, never overlapping) ----------
let sweeping = false;
async function sweep() {
  if (sweeping) return;
  sweeping = true;
  try {
    // Warm every pod the UI has touched; the first sweep also discovers pods.
    let ids = store.podIds();
    if (!ids.length) {
      try {
        ids = (await transports.fetchPods()).map((p) => p.id);
      } catch { /* Podium down — try again next sweep */ }
    }
    for (const id of ids) {
      try { await store.refresh(id, transports); }
      catch { /* one sick pod must not blind the others */ }
    }
  } finally {
    sweeping = false;
  }
}
setInterval(sweep, 60_000);
sweep();

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      // ----- express API (all reads come from the unified model) -----
      if (path === "/api/x/health") {
        const ok = await transports.ping();
        return json({ podium_url: PODIUM_URL, podium_ok: ok });
      }
      if (path === "/api/x/pods") {
        const pods = await transports.fetchPods();
        return json({ pods });
      }
      if (path === "/api/x/briefing") {
        const m = await modelFor(needPod(url));
        return json({ briefing: m.agent.briefing, generatedAt: m.agent.generatedAt, podName: m.podName });
      }
      if (path === "/api/x/impact") {
        const m = await modelFor(needPod(url));
        return json({ impact: m.impact, fetchedAt: m.fetchedAt });
      }
      if (path === "/api/x/threads") {
        const m = await modelFor(needPod(url));
        return json({ threads: m.threads, fetchedAt: m.fetchedAt });
      }
      if (path === "/api/x/focus") {
        const m = await modelFor(needPod(url));
        return json({ focus: m.focus, fetchedAt: m.fetchedAt });
      }
      if (path === "/api/x/nudges") {
        const m = await modelFor(needPod(url));
        return json({ nudges: m.agent.nudges, fetchedAt: m.fetchedAt });
      }
      if (path === "/api/x/objectives") {
        const m = await modelFor(needPod(url));
        return json({ objectives: m.objectives });
      }
      if (path === "/api/x/refresh" && req.method === "POST") {
        const m = await store.refresh(needPod(url), transports);
        return json({ ok: true, fetchedAt: m.fetchedAt });
      }

      // ----- static -----
      let p = decodeURIComponent(path);
      if (p === "/") p = "/index.html";
      const file = Bun.file(root + p.replace(/^\/+/, ""));
      if (await file.exists()) {
        const ext = p.slice(p.lastIndexOf("."));
        return new Response(file, { headers: { "Content-Type": TYPES[ext] || "application/octet-stream" } });
      }
      return new Response("not found", { status: 404 });
    } catch (e: any) {
      if (e instanceof PodiumUnreachable) return json({ error: "podium_unreachable", detail: e.causeText, podium_url: PODIUM_URL }, 502);
      const status = e?.status || 500;
      return json({ error: String(e?.message || "internal error").slice(0, 200) }, status);
    }
  },
});
console.log(`podium-express on http://127.0.0.1:${PORT} → podium at ${PODIUM_URL}`);
