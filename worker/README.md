# scores-refresh Worker

Tiny Cloudflare Worker that lets the public dashboard trigger a data refresh
without exposing any credentials. The page POSTs here every 30s; the Worker
throttles that down to **at most one build per minute** and calls the GitHub
`hourly` workflow via `workflow_dispatch`.

## How it works

```
browser (every 30s)  ──POST──▶  Worker  ──┐
                                          │ check latest run's created_at
                                          │   < 60s ago?  ▶ skip (throttled)
                                          │   else        ▶ workflow_dispatch
                                          └──────────────────────────────────▶ GitHub Actions
```

The GitHub token lives only as a Worker secret — never in the repo or the page.
The token can do exactly one thing (trigger this workflow), and the throttle
caps build frequency, so a public trigger endpoint is safe.

## Deploy

1. **Create a fine-grained PAT** (https://github.com/settings/tokens?type=beta):
   - Resource owner: your account · Repository access: only `365scores`.
   - Repository permissions → **Actions: Read and write**. Nothing else.
   - Copy the token.

2. **Install wrangler and deploy** (from this `worker/` directory):
   ```bash
   npm i -g wrangler        # or: npx wrangler ...
   wrangler login
   wrangler secret put GH_TOKEN   # paste the PAT when prompted
   wrangler deploy
   ```
   `wrangler deploy` prints the Worker URL, e.g.
   `https://scores-refresh.<your-subdomain>.workers.dev`.

3. **Point the page at it.** Put the URL in `docs/assets/dashboard.js`:
   ```js
   const REFRESH_ENDPOINT = "https://scores-refresh.<your-subdomain>.workers.dev";
   ```
   (If left empty, the page still auto-refreshes its view every 30s from the
   last server-built snapshot — it just won't trigger fresh builds.)

## Tuning

- **Throttle window:** `THROTTLE_MS` in `index.js` (default 60000 = 1/min).
- **Repo / workflow / ref:** uncomment the `[vars]` block in `wrangler.toml`,
  or change the defaults at the top of `index.js`.

## Test

```bash
curl -X POST https://scores-refresh.<your-subdomain>.workers.dev
# {"ok":true,"dispatched":true}    first call
# {"ok":true,"dispatched":false,"reason":"throttled"}   within 60s
```
