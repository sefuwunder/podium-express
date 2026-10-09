// podium-express — glossy mobile-first SPA. Zero deps, speaks /api/x/*.
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const view = $("view"), podSelect = $("pod-select");
  let currentView = "impact";
  // localStorage may be unavailable (private mode, sandboxed iframes) — degrade silently.
  const store = (() => { try { localStorage.setItem("__t", "1"); localStorage.removeItem("__t"); return localStorage; }
    catch { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; } })();
  let podId = store.getItem("px.pod") || "";
  let threadCache = [];

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const initials = (n) => String(n || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  async function api(path) {
    const r = await fetch(path);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status, detail: j });
    return j;
  }
  const skeleton = (n) => `<div class="skel"></div>`.repeat(n || 3);
  function errorCard(msg, retry) {
    return `<div class="card error-card"><div class="big">🔌</div><h3>Can't reach Podium</h3>
      <p class="muted">${esc(msg)}</p><button class="retry" data-retry="${retry}">Try again</button></div>`;
  }
  function podiumDown(detail) {
    view.innerHTML = errorCard(detail && detail.detail ? detail.detail : "Podium isn't answering. Is it running?", currentView);
  }

  // ---------- pods ----------
  async function loadPods() {
    try {
      const { pods } = await api("/api/x/pods");
      podSelect.innerHTML = pods.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
      if (!pods.length) { view.innerHTML = `<div class="empty">No pods in Podium yet.</div>`; return; }
      if (!pods.some((p) => p.id === podId)) podId = pods[0].id;
      podSelect.value = podId;
      store.setItem("px.pod", podId);
      render();
    } catch (e) { podiumDown(e.detail); }
  }
  podSelect.addEventListener("change", () => {
    podId = podSelect.value; store.setItem("px.pod", podId); render();
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    currentView = t.dataset.view;
    render();
  }));
  view.addEventListener("click", (e) => {
    const r = e.target.closest("[data-retry]");
    if (r) { currentView = r.dataset.retry; render(); return; }
    const th = e.target.closest("[data-thread]");
    if (th) return renderThread(th.dataset.thread);
    if (e.target.closest("[data-back]")) return renderThreadsList();
  });

  function render() {
    if (!podId) return loadPods();
    view.innerHTML = skeleton();
    ({ impact: renderImpact, threads: renderThreadsList, focus: renderFocus, nudges: renderNudges })[currentView]();
  }

  // ---------- impact ----------
  async function renderImpact() {
    try {
      const [{ impact }, { objectives }] = await Promise.all([
        api(`/api/x/impact?pod_id=${encodeURIComponent(podId)}`),
        api(`/api/x/objectives?pod_id=${encodeURIComponent(podId)}`).catch(() => ({ objectives: [] })),
      ]);
      const hero = `<div class="card hero"><h2>${impact.members.length} people · ${impact.total_hours}h</h2>
        <p class="sub">last 30 days · where time & talk moved the needle</p>
        <div class="stat-grid">
          <div class="stat"><b>${impact.avg_utilization_pct == null ? "—" : impact.avg_utilization_pct + "%"}</b><span>utilization</span></div>
          <div class="stat"><b>${impact.messages_total}</b><span>messages</span></div>
          <div class="stat"><b>${impact.objectives_on_track}/${impact.objectives_total}</b><span>on track</span></div>
          <div class="stat"><b>${impact.avg_progress_pct == null ? "—" : impact.avg_progress_pct + "%"}</b><span>progress</span></div>
        </div></div>`;
      const cards = impact.members.map((m) => {
        const hot = m.utilization_pct != null && m.utilization_pct >= 100;
        const trendIcon = m.trend === "up" ? "↗" : m.trend === "down" ? "↘" : "→";
        return `<div class="card"><div class="member">
          <div class="avatar">${esc(initials(m.name))}</div>
          <div class="grow"><h3>${esc(m.name)}</h3><div class="muted">${esc(m.role || "member")} · ${m.hours_logged}h · ${m.messages_sent} msgs</div></div>
          <div class="score-ring" style="--s:${m.score}"><b>${m.score}</b></div></div>
          ${m.utilization_pct != null ? `<div class="ubar${hot ? " hot" : ""}"><i style="width:${Math.min(100, m.utilization_pct)}%"></i></div>` : ""}
          <div class="reasons"><span class="chip ${m.trend === "up" ? "good" : m.trend === "down" ? "warn" : ""}"><span class="trend ${m.trend}">${trendIcon}</span> ${m.trend}</span>
          ${m.reasons.map((r) => `<span class="chip">${esc(r)}</span>`).join("")}</div></div>`;
      }).join("");
      const objs = objectives.length ? `<div class="section-title">Objectives</div>` + objectives.map((o) =>
        `<div class="card"><div class="row"><div class="grow"><h3>${esc(o.title)}</h3>
        <div class="muted">${o.progress_pct}% · ${esc(o.status.replace("_", " "))}</div></div>
        <div class="score-ring" style="--s:${o.progress_pct}"><b>${o.progress_pct}</b></div></div>
        <div class="ubar"><i style="width:${o.progress_pct}%"></i></div></div>`).join("") : "";
      view.innerHTML = hero + (cards || `<div class="empty">No members yet.</div>`) + objs;
    } catch (e) { podiumDown(e.detail); }
  }

  // ---------- threads ----------
  async function renderThreadsList() {
    try {
      const { threads } = await api(`/api/x/threads?pod_id=${encodeURIComponent(podId)}`);
      threadCache = threads;
      if (!threads.length) { view.innerHTML = `<div class="empty">No conversations yet.<br>Podium channels will appear here, one thread per person.</div>`; return; }
      view.innerHTML = `<div class="section-title">One thread per person · every channel</div>` + threads.map((t) =>
        `<button class="thread-row" data-thread="${esc(t.person_id)}">
          <div class="avatar">${esc(initials(t.name))}</div>
          <div class="grow"><div class="row"><h3 style="margin:0">${esc(t.name)}</h3><span class="grow"></span><span class="recency">${esc(t.last_at ? rel(t.last_at) : "—")}</span></div>
          <div class="chan-pills">${t.channels.map((c) => `<span class="chan">#${esc(c)}</span>`).join("")}<span class="chan" style="background:#efeaff;color:#3b2f8f">${t.message_count} msg${t.message_count === 1 ? "" : "s"}</span></div>
          <p class="preview">${esc(t.preview)}</p></div></button>`).join("");
    } catch (e) { podiumDown(e.detail); }
  }
  function renderThread(personId) {
    const t = threadCache.find((x) => x.person_id === personId);
    if (!t) return renderThreadsList();
    view.innerHTML = `<button class="backbtn" data-back>← All threads</button>
      <div class="card"><div class="member"><div class="avatar">${esc(initials(t.name))}</div>
      <div class="grow"><h3>${esc(t.name)}</h3><div class="muted">${t.message_count} messages · ${t.channels.length} channels</div></div></div></div>` +
      t.messages.map((m) => `<div class="card msg"><div class="meta"><span class="chan">#${esc(m.channel_name)}</span><span>${esc(rel(m.created_at))}</span></div><p>${esc(m.body) || "<i class='muted'>(empty)</i>"}</p></div>`).join("");
    view.scrollTop = 0; window.scrollTo(0, 0);
  }
  function rel(iso) {
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 1) return "now"; if (mins < 60) return mins + "m ago";
    const h = Math.round(mins / 60); if (h < 24) return h + "h ago";
    const d = Math.round(h / 24); return d < 30 ? d + "d ago" : Math.round(d / 30) + "mo ago";
  }

  // ---------- focus ----------
  async function renderFocus() {
    try {
      const { focus } = await api(`/api/x/focus?pod_id=${encodeURIComponent(podId)}`);
      if (!focus.length) { view.innerHTML = `<div class="empty">Nothing important right now.<br>Busywork stays out — that's the point. 🎯</div>`; return; }
      view.innerHTML = `<div class="section-title">Important only · busywork filtered out</div>` + focus.map((f) => {
        const due = f.due ? `<span class="duebadge${f.overdue ? "" : " soon"}">${f.overdue ? "overdue" : "due " + esc(f.due)}</span>` : "";
        return `<div class="card focus-card${f.kind === "key_result" ? " kr" : ""}${f.overdue ? " overdue" : ""}">
          <div class="row"><span class="kind">${f.kind === "key_result" ? "key result" : "task"}</span><span class="grow"></span>${due}</div>
          <h3 style="margin:6px 0">${esc(f.title)}</h3>
          <div class="reasons">${f.reasons.map((r) => `<span class="chip${/overdue/.test(r) ? " warn" : /key result|tied to/.test(r) ? " good" : ""}">${esc(r)}</span>`).join("")}</div>
          ${f.url ? `<p style="margin:8px 0 0"><a href="${esc(f.url)}" target="_blank" rel="noopener">Open →</a></p>` : ""}</div>`;
      }).join("");
    } catch (e) { podiumDown(e.detail); }
  }

  // ---------- nudges ----------
  async function renderNudges() {
    try {
      const { nudges } = await api(`/api/x/nudges?pod_id=${encodeURIComponent(podId)}`);
      $("nudge-dot").hidden = !nudges.some((n) => n.severity === "nudge");
      if (!nudges.length) { view.innerHTML = `<div class="empty">All quiet. The pod is humming. ✨</div>`; return; }
      const icon = { praise: "🌟", nudge: "💡", info: "ℹ️" };
      view.innerHTML = `<div class="section-title">Soft nudges from your embedded analyst</div>` + nudges.map((n) =>
        `<div class="card nudge ${n.severity}"><h3><span>${icon[n.severity]}</span><span class="grow">${esc(n.title)}</span></h3>
        <p>${esc(n.body)}</p><div class="row" style="margin-top:8px"><span class="sev ${n.severity}">${n.severity}</span></div></div>`).join("");
    } catch (e) { podiumDown(e.detail); }
  }

  loadPods();
})();
