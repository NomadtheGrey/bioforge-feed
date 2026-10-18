// ====================================================================
// The BioForge system feed — a tiny Worker serving ONE JSON
// document out of Cloudflare KV.
//
// WHY THIS EXISTS (Adam's design, 2026-10-18): two kinds of
// operator→player messages must reach every player wherever
// they play (the Workers site now, itch/portal embeds later):
//   (1) NEW-BUILD announcements — automated, stamped by the
//       merge flow after each wip→main merge;
//   (2) Adam's personal broadcasts — hand-made, rare.
//
// The feed lives OUTSIDE the game build on purpose: editing
// it never needs a game deploy. The game polls it politely
// (~5 min + on tab refocus), never blocks on it, and treats
// ANY failure — offline, 404, bad JSON — as silence.
//
// THE DOCUMENT (one KV key, "feed"):
//   {
//     "latestBuild": "2026-10-18T14:22Z",        // the newest
//                  build's baked stamp (see the game repo's
//                  src/game/buildNotes.ts for how stamps work)
//     "action": "none" | "refresh" |
//               "refresh-required" | "new-game", // what the
//                  update honestly asks of a player still
//                  running the old build mid-session
//     "broadcasts": [
//       { "id": "welcome-2026-10", "date": "2026-10-18",
//         "title": "…", "body": "…",
//         "priority": "panel" | "notice",
//         "expires": "2026-11-01" }              // optional
//     ]
//   }
//
// "panel" broadcasts wait quietly in the news seat and the
// in-game system stream; "notice" ones also toast once and
// may open the news once on first load. Expired broadcasts
// are filtered by the game client; removing them here is
// housekeeping, not correctness.
// ====================================================================

// The honest default when the KV key has never been written:
// no build stamped, nothing asked, nothing said.
const EMPTY_FEED = { latestBuild: '', action: 'none', broadcasts: [] };

export default {
  async fetch(request, env) {
    // CORS open: the game is served from the Workers site
    // today and from itch / portal embeds later — every one
    // of those origins must be able to read the feed.
    const headers = {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // ~60 s edge cache: a stamp may take a minute to reach
      // a polling player. That is fine — the messages
      // instruct, they never gate.
      'cache-control': 'public, max-age=60',
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
    }
    // ------------------------------------------------------------
    // THE PUBLISH DOOR (slice 4, Adam's rulings 2026-10-18).
    // POST /publish { code, title, body, priority } — the one
    // write path. The code is checked against the PUBLISH_CODE
    // secret, which lives ONLY in this Worker's configuration
    // (Adam sets it in the dashboard; it never travels through
    // a repo or a chat, and rotating it is a settings edit).
    // Without the secret configured, the door is closed and
    // says so — the composer in the kit reports it plainly.
    // Throttled from KV: a 15-second floor between publishes
    // and at most 10 in a trailing hour (best-effort — KV is
    // eventually consistent, and the door's real strength is
    // the secret, not the counter).
    // ------------------------------------------------------------
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/publish') {
      const json = (obj, status) =>
        new Response(JSON.stringify(obj), { status, headers: { ...headers, 'cache-control': 'no-store' } });
      if (!env.PUBLISH_CODE) return json({ error: 'Publishing is not switched on yet — the feed has no publish code set.' }, 503);
      let doc;
      try {
        doc = await request.json();
      } catch {
        return json({ error: 'That was not readable JSON.' }, 400);
      }
      if (typeof doc?.code !== 'string' || doc.code !== env.PUBLISH_CODE) {
        return json({ error: 'The feed does not know that code.' }, 401);
      }
      const title = typeof doc.title === 'string' ? doc.title.trim().slice(0, 120) : '';
      const body = typeof doc.body === 'string' ? doc.body.trim().slice(0, 600) : '';
      const priority = doc.priority === 'notice' ? 'notice' : 'panel';
      if (!title || !body) return json({ error: 'A broadcast needs a title and a body.' }, 400);

      let throttle = { last: 0, hour: [] };
      try {
        const rawT = await env.FEED.get('ratelimit');
        if (rawT) throttle = JSON.parse(rawT);
      } catch { /* a lost counter reads as a fresh one */ }
      const now = Date.now();
      throttle.hour = (throttle.hour || []).filter((t) => now - t < 3600_000);
      if (now - (throttle.last || 0) < 15_000 || throttle.hour.length >= 10) {
        return json({ error: 'Easy — the feed takes a breath between broadcasts. Try again in a moment.' }, 429);
      }

      let feed = { ...EMPTY_FEED };
      try {
        const rawF = await env.FEED.get('feed');
        if (rawF) feed = { ...EMPTY_FEED, ...JSON.parse(rawF) };
      } catch { /* a garbled stored doc is rebuilt around the new word */ }
      const stamp = new Date(now).toISOString();
      const broadcast = {
        id: `b-${stamp.slice(0, 10)}-${stamp.slice(11, 19).replace(/:/g, '')}`,
        date: stamp.slice(0, 10),
        title,
        body,
        priority,
      };
      // Newest first; the stored list is capped at 20 — the
      // channel is rare by design, and old word is history.
      feed.broadcasts = [broadcast, ...(feed.broadcasts || [])].slice(0, 20);
      await env.FEED.put('feed', JSON.stringify(feed));
      throttle.last = now;
      throttle.hour.push(now);
      await env.FEED.put('ratelimit', JSON.stringify(throttle));
      return json({ ok: true, id: broadcast.id }, 200);
    }
    if (request.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'the feed is read-only' }), { status: 405, headers });
    }
    let raw = null;
    try {
      raw = await env.FEED.get('feed');
    } catch {
      raw = null; // a KV hiccup reads as silence, never as an error page
    }
    if (!raw) return new Response(JSON.stringify(EMPTY_FEED), { headers });
    // Serve the stored document verbatim — it was validated
    // by whoever stamped it, and the game client validates
    // defensively on its side too.
    return new Response(raw, { headers });
  },
};
