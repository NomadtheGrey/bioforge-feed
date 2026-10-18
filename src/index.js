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
      return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, OPTIONS' } });
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
