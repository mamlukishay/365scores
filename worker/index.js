/* Cloudflare Worker: on-demand refresh trigger for the 365scores dashboard.
 *
 * The dashboard is a public static site (GitHub Pages), so it can't hold a
 * GitHub token. This Worker holds it as a secret and is the ONLY thing that
 * can kick the `hourly` workflow. The page POSTs here every 30s; the Worker
 * collapses that traffic down to at most one build per minute (global throttle)
 * by checking when the most recent run was created before dispatching a new one.
 *
 * Secrets / vars (set with `wrangler secret put` / in wrangler.toml [vars]):
 *   GH_TOKEN  (secret, required) — fine-grained PAT, repo-scoped, Actions: R/W.
 *   REPO      (var, optional)    — "owner/name". Defaults below.
 *   WORKFLOW  (var, optional)    — workflow file name. Defaults below.
 */

const DEFAULT_REPO = "mamlukishay/365scores";
const DEFAULT_WORKFLOW = "hourly.yml";
const DEFAULT_REF = "main";
const THROTTLE_MS = 60_000; // at most one dispatched build per minute

const cors = (resp) => {
  resp.headers.set("Access-Control-Allow-Origin", "*");
  resp.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resp.headers.set("Access-Control-Allow-Headers", "Content-Type");
  resp.headers.set("Access-Control-Max-Age", "86400");
  return resp;
};
const json = (body, status = 200) =>
  cors(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
    if (!env.GH_TOKEN) return json({ ok: false, error: "Worker missing GH_TOKEN secret" }, 500);

    const repo = env.REPO || DEFAULT_REPO;
    const workflow = env.WORKFLOW || DEFAULT_WORKFLOW;
    const ref = env.REF || DEFAULT_REF;

    const gh = (path, init) =>
      fetch(`https://api.github.com/repos/${repo}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "365scores-refresh-worker",
          ...(init && init.headers),
        },
      });

    // Throttle: if the most recent run was created < THROTTLE_MS ago, don't
    // dispatch another one. GitHub is the shared source of truth, so this holds
    // globally across every viewer and every Worker edge location.
    try {
      const res = await gh(`/actions/workflows/${workflow}/runs?per_page=1`);
      if (res.ok) {
        const data = await res.json();
        const last = data.workflow_runs && data.workflow_runs[0] && data.workflow_runs[0].created_at;
        if (last && Date.now() - Date.parse(last) < THROTTLE_MS) {
          return json({ ok: true, dispatched: false, reason: "throttled" });
        }
      }
    } catch {
      /* if the check fails, fall through and try to dispatch anyway */
    }

    const res = await gh(`/actions/workflows/${workflow}/dispatches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    if (res.status !== 204) {
      const text = await res.text().catch(() => "");
      return json({ ok: false, dispatched: false, status: res.status, error: text || "dispatch failed" }, 502);
    }
    return json({ ok: true, dispatched: true });
  },
};
