# HSC Ops Hub

Field app for Hammer Street Clean. Plain HTML/JS in `app/` (no build step),
deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to
`main`. Run it locally with `npx serve app -p 3000`.

## Before you push

- **Every push to this repo emails the BIA.** Do not commit or push without
  Haven's explicit yes for that push. Batch changes so one push carries them.
- The Cloudflare workers (`weather-worker`, `captions-worker`,
  `hsc-post-upload`, laundry worker) are **not** in this repo and never go
  through it. They live on Haven's PC under `E:\HammerStreet\` and deploy
  with `wrangler`. Secrets are set with `wrangler secret put`, never written
  in code.
- Bump the version in `app/index.html` (`app-version`) for user-facing
  changes and put it in the commit subject, e.g. `feat: ... (v2.20.0)`.

## Working rules

1. **Check main first.** Start every task with `git fetch origin` and compare
   your branch with `origin/main`. If main has moved, bring it in before you
   change anything, and look at what changed so you don't redo or undo work
   another session already pushed.
2. **Verify facts.** Every name, place, date, count, price, by-law, law or
   health claim in a post, caption, report or message to the BIA must come
   from Haven, the photo or record itself, or a source you actually checked.
   Never fill a gap with a guess. If you can't confirm it, leave it out or
   ask. "Draft with AI" captions are drafts: check each line before sending.
3. **Name what confirms it.** When you say something is done, true, live or
   fixed, say what shows it: the commit hash, `file:line`, the command and
   its output, or the page you checked. If nothing confirmed it, say it is
   unverified.

## Social posts

- Hashtags: **at most 5 on Instagram and Facebook, at most 1 on Threads**
  (Threads keeps only the first one, so put the best tag first). X and
  Bluesky have no tag limit but count characters (280 / 300; X counts emoji
  as 2).
- Threads captions are capped at 500 characters.
- Posts go out through the app's Branded Post page (Saved → Send to queue),
  which calls `hsc-post-upload` `POST /queue`. The worker re-checks these
  limits and refuses a caption that breaks them.
- Times are Eastern (`America/Toronto`).
