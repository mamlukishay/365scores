# 365Scores Predictions Cup — data puller + infographics

Pulls a private Predictions Cup group from 365Scores (the `bolao.365scores.com`
game, API at `wcg-il.365scores.com`) into timestamped JSON snapshots, then builds
an interactive dashboard + PNG charts on top.

## One-time setup

Already done in this repo: `npm install` pulled Playwright and a Chromium binary,
and Chart.js is vendored under `assets/`.

## Workflow

### 1. Log in once (`capture.mjs`)
```bash
npm run capture
```
- Writes raw snapshots into the project-local, gitignored `reports/snapshots/` dir.
- Opens a real Chromium → **log into 365Scores**. The login is saved in
  `.browser-profile/`, so you only do this once.
- Browse into your group, press ENTER to save a raw snapshot of everything seen.

`capture.mjs` is the exploratory tool. For routine use, prefer `pull.mjs` below.

### 2. Pull a group (`pull.mjs`) — headless, repeatable
```bash
npm run pull                 # default group
node pull.mjs --group=17578  # a specific group
node pull.mjs --headed       # show the browser if the login expired
```
Reuses the saved login, captures the live auth token from the bolao app, then
fetches the leaderboard **and every member's full prediction history**. Writes:
- `<dataDir>/snapshots/group-<id>-<timestamp>.json`  (history)
- `<dataDir>/snapshots/group-<id>-latest.json`       (stable pointer)

Run it whenever you want fresh data — each run adds a timestamped snapshot.

### 3. Build infographics (`infographics.mjs`)
```bash
npm run graphs            # newest snapshot
node infographics.mjs --open          # also open the dashboard
node infographics.mjs /path/snap.json # a specific snapshot
```
Writes `<dataDir>/reports/group-<id>-<timestamp>/`:
- `dashboard.html` — interactive (hover, legend toggle); self-contained/offline.
- `dashboard-full.png` — the whole board as one image.
- `charts/*.png` — standings, points-race, accuracy, champion-picks,
  topscorer-picks, similarity — each as a shareable PNG.

### 4. Deploy to Netlify (`deploy.mjs`) — one command does everything
```bash
npm run deploy                 # pull fresh data → build dashboard → deploy to prod
node deploy.mjs --group=17578  # a specific group
node deploy.mjs --no-pull      # skip the pull, rebuild+deploy newest snapshot
node deploy.mjs --no-graphs    # deploy the newest existing report as-is
node deploy.mjs --draft        # preview (non-production) URL
```
Chains steps 2–3, then publishes the newest `reports/group-*` folder to Netlify via
`npx netlify-cli` (no global install). It copies `dashboard.html` → `index.html` so
the site serves at `/`. **First run only:** a browser opens to log in to Netlify and
create/pick a site; the choice is saved in `./.netlify/`, so every later run is just
`npm run deploy`.

## The dashboard (interactive)
Sports-broadcast styled, fully offline. Open `dashboard.html` in a browser.

- **Viewer dropdown (top-right)** — pick any player; the whole board re-highlights
  for them and the personalized stat cards update (with count-up animations).
  Selecting the current #1 triggers a confetti burst.
- **Podium** — top 3 with medals.
- **Your card** — rank, hit rate, exact scores, best day, best region, bravery,
  contrarian %, and "signature call" (your most against-the-odds exact hit).
- **Group awards** — most accurate, sniper, bravest, most contrarian, best day, wooden spoon.
- **Leaderboard** — toggle metric: Points / Correct picks / Exact scores / Normalized.
- **By region** — radar of the selected player vs group average across the six
  continents; toggle Pts-per-game / Hit-rate.
- **The race** — toggle cumulative Points (line) or Rank (bump chart) over match days.
- **Playing style** — bubble scatter; toggle Bravery (goals predicted vs points)
  or Contrarian (% vs crowd vs points). Bubble size = boldness.
- **Accuracy breakdown** — exact / right-result / miss, per player.
- **Best days** — heatmap of points per match day (your row highlighted).
- **Nemesis & bankers** — the matches the whole group missed vs nailed.
- **Similarity** — % identical exact picks between every pair.

PNGs of every section are written to `charts/` (rendered in a clean static mode),
plus `dashboard-full.png` for the whole board.

Region grouping is geographic continents (see `lib/continents.mjs`).

## Files
- `capture.mjs` — interactive login + raw network capture.
- `pull.mjs` — headless targeted pull of a full group.
- `infographics.mjs` — snapshot → dashboard + PNGs.
- `lib/settings.mjs` — folder picker + remembered data dir.
- `lib/analyze.mjs` — snapshot → metrics.
- `lib/dashboard.mjs` — metrics → HTML.
