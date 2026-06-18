#!/usr/bin/env node
// 365Scores Predictions Cup — targeted headless pull.
//
// Reuses the saved browser login (from `capture.mjs`) and fetches a complete,
// consolidated snapshot of a group: the leaderboard plus every member's full
// prediction history. Writes one timestamped file per run for history.
//
// Usage:
//   node pull.mjs                 pull the default group (headless)
//   node pull.mjs --group=17578   pull a specific group
//   node pull.mjs --headed        show the browser (use if login expired)
//   node pull.mjs --pick-dir      re-choose the data directory

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir, ROOT } from "./lib/settings.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.find((a) => a.startsWith(`--${n}=`)) || "").split("=")[1];

const API = "https://wcg-il.365scores.com";
const APP = "https://bolao.365scores.com";
const LANG = 2;
const PROFILE_DIR = join(ROOT, ".browser-profile");
const groupArg = opt("group");

// Wait until the app fires an authenticated API request, then grab its
// Authorization header so we can replay it for every member call.
function sniffAuth(context) {
  return new Promise((resolve) => {
    const done = (h) => { context.off("request", onReq); resolve(h); };
    const onReq = (req) => {
      const auth = req.headers()["authorization"];
      if (auth && /wcg-il\.365scores\.com/.test(req.url())) done(auth);
    };
    context.on("request", onReq);
    setTimeout(() => done(null), 15000);
  });
}

async function main() {
  const dataDir = await getDataDir({ force: flag("--pick-dir") });
  if (!dataDir) { console.error("✖ No data directory chosen."); process.exit(1); }
  console.error(`• Data directory: ${dataDir}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !flag("--headed"),
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  // Load the bolao app (deep-link to the group if known) and sniff its auth.
  const page = context.pages()[0] || (await context.newPage());
  const authP = sniffAuth(context);
  const entry = groupArg ? `${APP}/leaderboard/${groupArg}` : `${APP}/`;
  console.error(`• Opening ${entry} to capture session…`);
  await page.goto(entry, { waitUntil: "domcontentloaded" }).catch(() => {});
  const authHeader = await authP;
  if (!authHeader) {
    console.error("✖ Couldn't capture an auth token. Login may have expired — rerun with --headed and log in.");
    await context.close();
    process.exit(1);
  }
  console.error("• Session captured.");

  const get = async (path) => {
    const res = await context.request.get(`${API}${path}`, {
      headers: { Accept: "application/json", Authorization: authHeader, Referer: `${APP}/` },
    });
    if (!res.ok()) throw new Error(`${res.status()} ${res.statusText()} for ${path}`);
    const body = await res.json();
    if (body.ok === false) throw new Error(`API not ok for ${path}: ${body.errorMessage || body.errorCode}`);
    return body;
  };

  console.error("• Fetching your groups…");
  const groupsResp = await get(`/Groups/GetUserGroups?lang=${LANG}`);
  const groups = groupsResp.groups || [];
  if (!groups.length) {
    console.error("✖ No groups found. Login may have expired — rerun with --headed and log in.");
    await context.close();
    process.exit(1);
  }

  // Pick the target group: explicit arg > first non-global group > first.
  let target = groupArg ? groups.find((g) => String(g.groupID) === groupArg) : null;
  if (!target) target = groups.find((g) => g.groupID !== 1) || groups[0];
  console.error(`• Group: ${target.name} (id ${target.groupID}, ${target.membersCount} members)`);

  const tableResp = await get(`/Groups/GetGroupTable?lang=${LANG}&groupID=${target.groupID}`);
  const members = tableResp.table?.members || [];
  console.error(`• Leaderboard: ${members.length} members`);

  const tournament = await get(`/Tournament/GetTournamentInfo?lang=${LANG}`).catch((e) => {
    console.error("  (tournament info unavailable: " + e.message + ")"); return null;
  });

  // Fetch each member's full prediction history.
  const predictions = {};
  for (const m of members) {
    process.stderr.write(`• Predictions: ${m.name} (#${m.rank})… `);
    try {
      const r = await get(`/Games/GetAllGamesForOtherUser?lang=${LANG}&otherUserId=${m.userID}`);
      predictions[m.userID] = {
        userID: m.userID,
        name: m.name,
        winnerTeamID: r.winnerTeamID,
        winnerTeamName: r.winnerTeamName,
        topScorerID: r.topScorerID,
        topScorerName: r.topScorerName,
        games: r.games || [],
      };
      console.error(`${r.games?.length || 0} games`);
    } catch (e) {
      console.error("failed: " + e.message);
    }
  }

  const pulledAt = new Date().toISOString();
  const snapshot = {
    pulledAt,
    api: API,
    group: {
      groupID: target.groupID,
      name: target.name,
      membersCount: target.membersCount,
      invitationLink: target.invitationLink,
      userRank: target.userRank,
    },
    leaderboard: members,
    predictions,
    tournament,
  };

  const stamp = pulledAt.replace(/[:.]/g, "-");
  const snapDir = join(dataDir, "snapshots");
  await mkdir(snapDir, { recursive: true });
  const outPath = join(snapDir, `group-${target.groupID}-${stamp}.json`);
  await writeFile(outPath, JSON.stringify(snapshot, null, 2));
  // Also keep a stable "latest" pointer for the infographics step.
  await writeFile(join(snapDir, `group-${target.groupID}-latest.json`), JSON.stringify(snapshot, null, 2));

  console.error(`\n✔ Saved snapshot → ${outPath}`);
  console.error(`✔ Updated latest → group-${target.groupID}-latest.json`);
  await context.close();
}

main().catch((e) => { console.error("✖ " + e.stack); process.exit(1); });
