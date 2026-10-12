// podium-express — Apple-like SPA. Zero deps, reads the unified PodModel via /api/x/*.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const view = $("view"), podButton = $("pod-button"), podName = $("pod-name");
  const sheet = $("pod-sheet"), podList = $("pod-list");
  let currentView = "threads";
  const store = (() => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return localStorage; }
    catch { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; } })();
  let podId = store.getItem("px.pod") || "";
  let pods = [];
  let threadCache = [];

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  async function api(path, opts) {
    const r = await fetch(path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, detail: j });
    return j;
  }
  const skeleton = (n) => `<div class="skel"></div>`.repeat(n || 3);
  const greeting = () => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  };

  function podiumDown(detail) {
    view.innerHTML = `<div class="large-title">Offline</div>
      <div class="card error-card"><h3>Can't reach Podium</h3>
      <p class="subtitle">${esc(detail && detail.detail ? detail.detail : "Is it running?")}</p>
      <button class="retry" data-retry="${currentView}">Try again</button></div>`;
  }

  // ---------- pods ----------
  async function loadPods() {
    try {
      const res = await api("/api/x/pods");
      pods = res.pods || [];
      if (!pods.length) { view.innerHTML = `<div class="empty">No pods in Podium yet.</div>`; return; }
      if (!pods.some((p) => p.id === podId)) podId = pods[0].id;
      store.setItem("px.pod", podId);
      syncPodButton();
      render();
    } catch (e) { podiumDown(e.detail); }
  }
  function syncPodButton() {
    const p = pods.find((x) => x.id === podId);
    podName.textContent = p ? p.name : "Podium Express";
  }
  podButton.addEventListener("click", () => {
    podList.innerHTML = pods.map((p) =>
      `<button class="row" data-pod="${esc(p.id)}"><div class="grow"><h3>${esc(p.name)}</h3>
       <div class="sub">${esc(p.client_name || "")}</div></div>${p.id === podId ? "<span style='color:var(--accent)'>✓</span>" : ""}</button>`).join("");
    sheet.hidden = false;
  });
  $("pod-close").addEventListener("click", () => { sheet.hidden = true; });
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.hidden = true; });
  podList.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pod]");
    if (!b) return;
    podId = b.dataset.pod; store.setItem("px.pod", podId);
    syncPodButton(); sheet.hidden = true; render();
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => { x.classList.remove("active"); x.setAttribute("aria-selected", "false"); });
    t.classList.add("active"); t.setAttribute("aria-selected", "true");
    currentView = t.dataset.view;
    render();
  }));
  view.addEventListener("click", (e) => {
    const r = e.target.closest("[data-retry]");
    if (r) { currentView = r.dataset.retry; render(); return; }
    const th = e.target.closest("[data-thread]");
    if (th) return renderThread(th.dataset.thread);
    if (e.target.closest("[data-back]")) return renderThreadsList();
    const rf = e.target.closest("[data-refresh]");
    if (rf) { api(`/api/x/refresh?pod_id=${encodeURIComponent(podId)}`, { method: "POST" }).then(render).catch(render); }
  });

  function render() {
    if (!podId) return loadPods();
    view.innerHTML = `<div class="large-title">${titleFor(currentView)}</div>` + skeleton();
    ({ threads: renderThreads, focus: renderFocus, impact: renderImpact, nudges: renderNudges })[currentView]();
  }
  const titleFor = (v) => ({ threads: "Threads", focus: "Focus", impact: "Impact", nudges: "Nudges" }[v] || "");

  function rel(iso) {
    if (!iso) return "—";
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return "now"; if (mins < 60) return mins + "m";
    const h = Math.round(mins / 60); if (h < 24) return h + "h";
    const d = Math.round(h / 24); return d < 7 ? d + "d" : new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // ---------- threads (home) ----------
  async function renderThreads() {
    try {
      const [{ threads }, { briefing }] = await Promise.all([
        api(`/api/x/threads?pod_id=${encodeURIComponent(podId)}`),
        api(`/api/x/briefing?pod_id=${encodeURIComponent(podId)}`).catch(() => ({ briefing: [] })),
      ]);
      threadCache = threads;
      const brief = briefing && briefing.length
        ? `<div class="briefing"><h2>${greeting()}</h2><div class="when">Here's your pod at a glance</div>
           <ul>${briefing.map((b) => `<li>${esc(b)}</li>`).join("")}</ul></div>` : "";
      const list = threads.length
        ? `<div class="rows">` + threads.map((t) =>
            `<button class="row" data-thread="${esc(t.person_id)}">
              <div class="avatar">${esc(initials(t.name))}</div>
              <div class="grow"><h3>${esc(t.name)}</h3><div class="sub">${esc(t.preview) || "—"}</div></div>
              <span class="time">${esc(rel(t.last_at))}</span><span class="chev">›</span>
            </button>`).join("") + `</div>`
        : `<div class="empty">No conversations yet.<br>Podium channels will appear here.</div>`;
      view.innerHTML = `<div class="large-title">Threads</div><p class="subtitle">One thread per person · every channel</p>` + brief + list;
    } catch (e) { podiumDown(e.detail); }
  }
  function renderThreadsList() { renderThreads(); }
  function renderThread(personId) {
    const t = threadCache.find((x) => x.person_id === personId);
    if (!t) return renderThreadsList();
    view.innerHTML = `<button class="backbtn" data-back>‹ Threads</button>
      <div class="large-title" style="margin-top:0">${esc(t.name)}</div>
      <p class="subtitle">${t.message_count} message${t.message_count === 1 ? "" : "s"} · ${t.channels.length} channel${t.channels.length === 1 ? "" : "s"}</p>` +
      t.messages.map((m) => `<div class="card msg"><div class="meta">
        <span class="pill">#${esc(m.channel_name)}</span><span class="time">${esc(rel(m.created_at))}</span></div>
        <p class="body">${esc(m.body) || "<span style='color:var(--ink-3)'>(empty)</span>"}</p></div>`).join("");
    window.scrollTo(0, 0);
  }

  // ---------- focus ----------
  async function renderFocus() {
    try {
      const { focus } = await api(`/api/x/focus?pod_id=${encodeURIComponent(podId)}`);
      if (!focus.length) {
        view.innerHTML = `<div class="large-title">Focus</div><div class="empty">Nothing important right now.<br>Busywork stays out — that's the point.</div>`;
        return;
      }
      view.innerHTML = `<div class="large-title">Focus</div><p class="subtitle">Important only · busywork filtered out</p>
        <div class="rows">` + focus.map((f) => {
          const badge = f.overdue ? `<span class="badge overdue">Overdue</span>`
            : f.due ? `<span class="badge soon">${esc(f.due)}</span>`
            : f.kind === "key_result" ? `<span class="badge kr">Key result</span>` : "";
          return `<div class="row" style="cursor:default"><div class="grow">
            <div class="kind">${f.kind === "key_result" ? "Key result" : "Task"}</div>
            <h3 style="margin:4px 0">${esc(f.title)}</h3>
            <div class="chips">${f.reasons.map((r) => `<span class="chip${/overdue/.test(r) ? " warn" : /key result|tied to/.test(r) ? " good" : ""}">${esc(r)}</span>`).join("")}</div>
            ${f.url ? `<p style="margin:8px 0 0"><a href="${esc(f.url)}" target="_blank" rel="noopener">Open</a></p>` : ""}
            </div>${badge}</div>`;
        }).join("") + `</div>`;
    } catch (e) { podiumDown(e.detail); }
  }

  // ---------- impact ----------
  async function renderImpact() {
    try {
      const [{ impact }, { objectives }] = await Promise.all([
        api(`/api/x/impact?pod_id=${encodeURIComponent(podId)}`),
        api(`/api/x/objectives?pod_id=${encodeURIComponent(podId)}`).catch(() => ({ objectives: [] })),
      ]);
      const hero = `<div class="card"><div class="stat-grid">
          <div class="stat"><b>${impact.avg_utilization_pct == null ? "—" : impact.avg_utilization_pct + "%"}</b><span>Utilization</span></div>
          <div class="stat"><b>${impact.messages_total}</b><span>Messages</span></div>
          <div class="stat"><b>${impact.objectives_on_track}/${impact.objectives_total}</b><span>On track</span></div>
          <div class="stat"><b>${impact.avg_progress_pct == null ? "—" : impact.avg_progress_pct + "%"}</b><span>Progress</span></div>
        </div></div>`;
      const cards = impact.members.map((m) => {
        const hot = m.utilization_pct != null && m.utilization_pct >= 100;
        const trendCls = m.trend === "up" ? "trend-up" : m.trend === "down" ? "trend-down" : "trend-flat";
        const trendIcon = m.trend === "up" ? "↑" : m.trend === "down" ? "↓" : "→";
        return `<div class="card"><div style="display:flex;align-items:center;gap:12px">
          <div class="avatar">${esc(initials(m.name))}</div>
          <div class="grow"><h3 style="margin:0">${esc(m.name)}</h3>
          <div class="sub" style="color:var(--ink-3);font-size:13px">${esc(m.role || "member")} · ${m.hours_logged}h · ${m.messages_sent} msgs</div></div>
          <div class="score">${m.score}</div></div>
          ${m.utilization_pct != null ? `<div class="ubar${hot ? " hot" : ""}"><i style="width:${Math.min(100, m.utilization_pct)}%"></i></div>` : ""}
          <div class="chips"><span class="chip"><span class="${trendCls}">${trendIcon}</span> ${esc(m.trend)}</span>
          ${m.reasons.map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div></div>`;
      }).join("");
      const objs = objectives.length
        ? `<div class="section-label">Objectives</div><div class="rows">` + objectives.map((o) =>
            `<div class="row" style="cursor:default"><div class="grow"><h3>${esc(o.title)}</h3>
             <div class="sub">${o.progress_pct}% · ${esc(String(o.status).replace("_", " "))}</div>
             <div class="ubar"><i style="width:${o.progress_pct}%"></i></div></div></div>`).join("") + `</div>` : "";
      view.innerHTML = `<div class="large-title">Impact</div>
        <p class="subtitle">${impact.members.length} people · ${impact.total_hours}h · last 30 days</p>`
        + hero + cards + objs;
    } catch (e) { podiumDown(e.detail); }
  }

  // ---------- nudges ----------
  async function renderNudges() {
    try {
      const { nudges } = await api(`/api/x/nudges?pod_id=${encodeURIComponent(podId)}`);
      $("nudge-dot").hidden = !nudges.some((n) => n.severity === "nudge");
      if (!nudges.length) {
        view.innerHTML = `<div class="large-title">Nudges</div><div class="empty">All quiet. The pod is humming.</div>`;
        return;
      }
      const sevLabel = { praise: "Praise", nudge: "Nudge", info: "Note" };
      view.innerHTML = `<div class="large-title">Nudges</div>
        <p class="subtitle">From your embedded analyst · gentle, with reasons</p>` +
        nudges.map((n) => `<div class="card nudge"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p>
          <span class="sev ${n.severity}">${sevLabel[n.severity] || n.severity}</span></div>`).join("");
    } catch (e) { podiumDown(e.detail); }
  }

  loadPods();
})();
