// podium-express — Relay-like unified threads (pure, deterministic).
//
// Condenses every channel of pod communication into one conversation view
// per person: all of their messages across all channels, chronological,
// each stamped with where it was said. Email legs can be merged in later
// via the same shape (channel = "email").

import type { PodMessage, Channel } from "./podium";

export interface ThreadMessage {
  id: string;
  author_id: string; author_name: string;
  body: string;
  channel_id: string; channel_name: string;
  created_at: string;
  reply_to: string | null;
}

export interface PersonThread {
  person_id: string; name: string;
  message_count: number;
  channels: string[];            // channel names involved, in first-seen order
  first_at: string | null;
  last_at: string | null;
  messages: ThreadMessage[];     // chronological
  preview: string;               // last message, trimmed
}

const clean = (md: string) => (md || "").replace(/\s+/g, " ").trim().slice(0, 280);

export function buildThreads(
  messagesByChannel: Array<{ channel: Channel; messages: PodMessage[] }>,
  nameOf: (authorId: string, fallback?: string) => string,
): PersonThread[] {
  const byPerson = new Map<string, ThreadMessage[]>();
  for (const { channel, messages } of messagesByChannel) {
    for (const m of messages) {
      const t: ThreadMessage = {
        id: m.id, author_id: m.author_id,
        author_name: m.author_name || nameOf(m.author_id),
        body: clean(m.body_md), channel_id: channel.id, channel_name: channel.name,
        created_at: m.created_at, reply_to: m.thread_parent_id,
      };
      if (!byPerson.has(m.author_id)) byPerson.set(m.author_id, []);
      byPerson.get(m.author_id)!.push(t);
    }
  }
  const threads: PersonThread[] = [];
  for (const [pid, msgs] of byPerson) {
    msgs.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const channels: string[] = [];
    for (const m of msgs) if (!channels.includes(m.channel_name)) channels.push(m.channel_name);
    threads.push({
      person_id: pid,
      name: msgs[0].author_name,
      message_count: msgs.length,
      channels,
      first_at: msgs[0]?.created_at || null,
      last_at: msgs[msgs.length - 1]?.created_at || null,
      messages: msgs,
      preview: msgs[msgs.length - 1]?.body || "",
    });
  }
  // most recently active first
  threads.sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
  return threads;
}

/** Recency label for the thread list ("2h ago", "3d ago", …). */
export function recency(iso: string | null, nowMs = Date.now()): string {
  if (!iso) return "—";
  const mins = Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}
