# Legacy — original local pipeline (archived)

This directory is the **previous implementation**: a local, interactive
Playwright tool that logged into 365Scores in a real browser, pulled a group
snapshot (`pull.mjs` / `capture.mjs`), rendered an HTML dashboard plus PNG
screenshots (`infographics.mjs`), and deployed the static result to Netlify
(`deploy.mjs`).

It has been replaced by the root project: a static GitHub Pages site whose data
is refreshed by a GitHub Actions cron (`build.mjs`, no browser, token-based).
Kept here for reference only — nothing at the repo root depends on it.
