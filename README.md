# 365Scores Predictions Cup

A static, multi-tenant dashboard that visualizes each user's 365Scores
Predictions Cup standings. The site is served by **GitHub Pages** straight from
the repo's `docs/` folder, and a **GitHub Actions cron (every 15 minutes)**
fetches fresh prediction data per user and writes the JSON the page renders.

There is **no browser / Playwright** anymore — data is fetched directly from the
365Scores API using each user's bearer token.

Each user has a **slug** and is visited at `https://<site>/<slug>`.

> Replace `<site>` and `<OWNER>/<REPO>` placeholders below with your own values.

## How it works

1. `build.mjs` (Node 24, zero dependencies) reads:
   - the committed, public `config/{slug}.json` files (which groups to track), and
   - per-user 365Scores bearer tokens from the `USER_TOKENS` environment variable
     (a JSON string `{ slug: token }`).
2. It fetches each user's data and writes `docs/data/{slug}.json`.
3. The Actions workflow commits any changed JSON back to `main`.
4. GitHub Pages serves the updated `docs/` — the page re-renders with fresh data.

## Repo layout

```
docs/                     # the static site (published by GitHub Pages)
  index.html              # the dashboard
  admin.html              # onboarding / token-grabbing helper
  404.html                # SPA redirect for pretty /slug URLs
  .nojekyll               # disables Jekyll processing
  assets/                 # CSS/JS/images
  data/                   # generated: data/{slug}.json (committed by CI)
config/{slug}.json        # public per-user config (groups to track, no tokens)
build.mjs                 # Node 24, no deps: fetches data -> docs/data/{slug}.json
.github/workflows/hourly.yml  # the 15-minute refresh cron
```

## One-time GitHub Pages setup

In your repo: **Settings → Pages**

- **Source:** "Deploy from a branch"
- **Branch:** `main`
- **Folder:** `/docs`

Notes:

- `docs/.nojekyll` disables Jekyll so files/folders starting with `_` are served
  as-is.
- Pretty `/<slug>` URLs work via the SPA `404.html` redirect trick: GitHub Pages
  serves `404.html` for unknown paths, which redirects into `index.html` and
  restores the requested slug client-side.

## The `USER_TOKENS` secret

Tokens are **never committed**. They live only in a GitHub Actions secret.

In your repo: **Settings → Secrets and variables → Actions → New repository
secret**

- **Name:** `USER_TOKENS`
- **Value:** a JSON object mapping slug → bearer token:

  ```json
  { "ishay": "<bearer>", "alice": "<bearer>" }
  ```

The `hourly.yml` workflow passes this secret to `build.mjs` as the `USER_TOKENS`
environment variable.

## Onboarding a new user

Tokens stay secret — only the public config is committed.

1. **Public config (the user does this).**
   The user opens `https://<site>/admin.html` and:
   - uses the bookmarklet to grab their 365Scores bearer token,
   - picks the groups to track,
   - gets a one-click link that pre-fills a `config/{slug}.json` commit on
     GitHub. They commit it (or open a PR) to add their public config.
2. **Token (kept private).**
   The user privately sends their bearer token to the repo owner, who adds it to
   the `USER_TOKENS` secret under that slug.

   > Tokens are roughly 6-month JWTs. When one expires, the user re-grabs it and
   > the owner updates the secret.

## Local development

```bash
# 1. Create a local, gitignored token file from the example.
cp secrets/tokens.example.json secrets/tokens.json
# 2. Fill in at least one slug -> bearer token in secrets/tokens.json

# 3. Build data (all configured users, or a single slug):
node build.mjs
node build.mjs <slug>

# 4. Preview the site with any static server:
npx serve docs
```

`secrets/tokens.json` is gitignored and never committed; it is only used to
populate tokens for local runs of `build.mjs`.

## Data shape

`docs/data/{slug}.json` is a map of `groupId -> metrics`:

```json
{
  "17578": { "...": "metrics for this group" },
  "20431": { "...": "metrics for this group" }
}
```

## The refresh workflow

`.github/workflows/hourly.yml`:

- runs on a `schedule` (`*/15 * * * *`, UTC) and via manual `workflow_dispatch`,
- runs `node build.mjs` with `USER_TOKENS` from the secret,
- commits any changes under `docs/data/` back to `main`.

GitHub may delay scheduled runs under load, and scheduled workflows
auto-disable after 60 days of **no repository activity** — the frequent data
commits keep this one active. Trigger it manually from the **Actions** tab if it
ever goes dormant.
