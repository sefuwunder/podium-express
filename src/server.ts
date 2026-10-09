// podium-express — glossy mobile-first executive lens on Podium pods.
// Speaks ONLY to Podium's HTTP API (the common-API contract). Bun + zero deps.

import { createPodiumClient, snapshotPod, PodiumUnreachable } from "./podium";
import { podImpact } from "./impact";
import { buildThreads } from "./threads";
import { buildFocus } from "./focus";
import { generateNudges } from "./nudges";

const PORT = Number(process.env.PORT || 3027);
const PODIUM_URL = process.env.PODIUM_URL || "http://127.0.0.1:3025";
const root = new URL("../public/", import.meta.url).pathname;

const client = createPodiumClient(PODIUM_URL);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
// short cache: snapshots are small; 20s keeps the UI snappy without hammering Podium
const cache = new Map<string, { at: number; body: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.body as T;
  const body = await fn();
  cache.set(key, { at: Date.now(), body });
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return body;
}
const needPod = (url: URL) => {
  const podId = url.searchParams.get("pod_id");
  if (!podId) throw Object.assign(new Error("pod_id required"), { status: 400 });
  return podId;
};

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      // ----- express API -----
      if (path === "/api/x/health") {
        const ok = await client.health();
        return json({ podium_url: PODIUM_URL, podium_ok: ok });
      }
      if (path === "/api/x/pods") {
        const pods = await cached("pods", 20000, () => client.pods());
        return json({ pods });
      }
      if (path === "/api/x/impact") {
        const podId = needPod(url);
        const body = await cached(`impact:${podId}`, 20000, async () => {
          const snap = await snapshotPod(client, podId);
          const msgs = snap.messagesByChannel.flatMap((x) => x.messages);
          return { impact: podImpact(podId, snap.members, snap.entries, msgs, snap.objectives, snap.windowDays) };
        });
        return json(body);
      }
      if (path === "/api/x/threads") {
        const podId = needPod(url);
        const body = await cached(`threads:${podId}`, 20000, async () => {
          const snap = await snapshotPod(client, podId);
          const nameOf = (pid: string) => snap.members.find((m) => m.person_id === pid)?.person_name || pid;
          return { threads: buildThreads(snap.messagesByChannel, nameOf) };
        });
        return json(body);
      }
      if (path === "/api/x/focus") {
        const podId = needPod(url);
        const body = await cached(`focus:${podId}`, 20000, async () => {
          const snap = await snapshotPod(client, podId);
          return { focus: buildFocus(snap.tasks, snap.objectives) };
        });
        return json(body);
      }
      if (path === "/api/x/nudges") {
        const podId = needPod(url);
        const body = await cached(`nudges:${podId}`, 20000, async () => {
          const snap = await snapshotPod(client, podId);
          return { nudges: generateNudges(snap) };
        });
        return json(body);
      }
      if (path === "/api/x/objectives") {
        const podId = needPod(url);
        const objectives = await cached(`obj:${podId}`, 20000, () => client.objectives(podId));
        return json({ objectives });
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
