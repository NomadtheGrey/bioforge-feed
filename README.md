# bioforge-feed — the BioForge system messages feed

A tiny Cloudflare Worker serving one JSON document from KV.
The game (BioForge) polls it to learn two things: whether a
newer build exists and what it asks of players still running
the old one, and whether Adam has posted a broadcast.
Design record: the game repo's `ReadMeFiles/SYSTEM_MESSAGES.md`.

## As built (2026-10-18 — live)

The feed is deployed and answering at
`https://bioforge-feed.nomadthegrey71.workers.dev/`.
It was set up through the Cloudflare API with Adam's
standing token rather than the dashboard, so this repo is
the source of record, not a deploy input:

1. KV namespace `bioforge-feed` exists:
   id `d7d52a8cc57842f0ab432a3af7dc8d02` (the value now
   standing in `wrangler.toml`).
2. The Worker was uploaded directly via the Workers API
   with the `FEED` binding to that namespace, and its
   workers.dev subdomain is enabled. To redeploy after an
   edit here, re-upload `src/index.js` the same way (the
   `deploy-feed` command in the Cloudflare connector
   helper), or run `npx wrangler deploy` in this repo.
3. The document is seeded with the honest empty feed
   (`latestBuild` empty, `action` `none`, no broadcasts)
   — live players hear silence until the first stamp.
   `feed.example.json` remains as the shape reference; its
   example broadcast was never seeded.

## The stamp — after every wip→main merge (the merge flow)

Every game build bakes its own stamp: the minute it was
built, `YYYY-MM-DDTHH:MMZ`. Read it from the deployed
site's **`/build.txt`** — a plain one-line file the build
emits beside the bundle, e.g.
`curl https://bioforge.nomadthegrey71.workers.dev/build.txt`.
(Do NOT grep the JS bundle for it: minification folds the
labeled stamp string away. The file is the sturdy carrier.)

After the merge's deploy verifies:

1. Read the new build's stamp from the live bundle.
2. Choose the action honestly — what does this update ask
   of a player still mid-session on the old build?
   - `none` — the stamp moves but nothing is asked (the
     build greets its own players on load; old sessions
     are not interrupted). The default for polish.
   - `refresh` — worth having soon: new content or fixes a
     player would want. The line reads: refresh when you
     reach a good stopping point.
   - `refresh-required` — the old build misbehaves against
     the new world (a save-shape or protocol change). The
     line asks plainly for a refresh soon. Still soft in
     v1: it instructs, it never forces.
   - `new-game` — the update asks for a fresh world (a
     world-generation change old worlds can't take). The
     atlas keeps the old worlds; the line says so.
3. Write the KV key `feed`: set `latestBuild` to the
   stamp, set `action`, leave `broadcasts` as they stand
   (or edit per below). Either route works — the dashboard
   (Storage & Databases → KV → `bioforge-feed` → edit key
   `feed`) or one API call (the `kv-put` command in the
   Cloudflare connector helper). The new stamp reaches
   polling players within about a minute.

## Broadcasts (rare, by design)

Adam dictates; Marlowe drafts for his approval; then the
approved text is added to the `broadcasts` array in the
same KV document:

- `id` — stable, unique, lowercase-with-dashes. The game
  remembers seen ids per device; reusing an id re-hides it.
- `date` — the day posted (`YYYY-MM-DD`).
- `title` / `body` — player voice; spoiler discipline like
  all copy (tease, never name a fate or an ending).
- `priority` — `panel` (waits in the news seat + the system
  stream) or `notice` (also toasts once, and may open the
  news once on a player's first load). Notice is for things
  a player should not miss; use it rarely.
- `expires` — optional `YYYY-MM-DD`; the game stops
  showing it after that day. Remove expired entries when
  convenient.

## Notes discipline

Every game landing carries baked release notes
(`src/game/buildNotes.ts` in the game repo) in player
voice; the notes are part of the landing's review surface.
The stamp step above does NOT carry notes — notes travel
inside the build itself, so a portal copy of the game
greets its players correctly even where the feed differs.
