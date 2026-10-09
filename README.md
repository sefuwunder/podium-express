# podium-express ⚡

The executive lens on [Podium](https://github.com/sefuwunder/podium) pods — a glossy,
mobile-first experience focused on **time + communication impact** as it relates to
completing pod objectives.

## The common-API contract

podium-express never touches Podium's database. Everything flows through Podium's
HTTP REST API (`PODIUM_URL`, default `http://127.0.0.1:3025`). If Podium is down,
podium-express says so honestly instead of guessing.

## The four tabs

- **📊 Impact** — per-member impact cards: hours vs allocation, comms volume,
  objective touch, an explained 0–100 score, and a trend arrow. Pod hero with
  utilization, message volume, objectives on-track, and average progress.
- **💬 Threads** — a Relay-like unified conversation view: every pod channel
  condensed into **one thread per person**, chronological, each message stamped
  with the channel it was said in.
- **🎯 Focus** — only *important* tasks reach the executive. An importance
  scorer (overdue, due soon, priority, objective tie-in, high-stakes topics)
  keeps busywork — "follow up", "sync", "file the admin" — out of the view.
  Key results always qualify: they're objective-linked by construction.
- **🔔 Nudges** — the embedded agent. A deterministic, explainable analyzer
  reads time, comms, and objective health and gives **soft** executive nudges:
  quiet members, at-risk objectives, overdue important tasks, praise for wins.
  No alarming language, ever — a test enforces it.

The agent is deliberately rule-based, not a model: every nudge carries its
reasoning, and the same input always produces the same nudge.

## Run it

```bash
bun src/server.ts
# → http://127.0.0.1:3027
```

Environment:

| var | default | what |
|---|---|---|
| `PORT` | `3027` | port to serve on |
| `PODIUM_URL` | `http://127.0.0.1:3025` | the Podium instance to read from |

Podium must be running first. No database, no build step, zero dependencies.

## API (express layer)

| route | what |
|---|---|
| `GET /api/x/health` | Podium reachability |
| `GET /api/x/pods` | pods |
| `GET /api/x/impact?pod_id=` | member + pod impact |
| `GET /api/x/threads?pod_id=` | per-person unified threads |
| `GET /api/x/focus?pod_id=` | important tasks + key results |
| `GET /api/x/nudges?pod_id=` | soft executive nudges |
| `GET /api/x/objectives?pod_id=` | objectives passthrough |

Responses are cached 20s server-side. Everything is `GET` — podium-express is
read-only; Podium remains the system of record.

## Tests

```bash
bun test   # 29 tests: impact, threads, focus, nudges, server (stubbed Podium)
```

## Stack

Bun + zero dependencies. The UI is vanilla JS/CSS — glassy cards, gradient
hero, bottom tab bar, reduced-motion aware.
