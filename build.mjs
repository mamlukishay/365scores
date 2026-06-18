#!/usr/bin/env node
// 365Scores Predictions Cup — static data pipeline.
//
// Reads each user config (config/*.json), looks up that user's bearer token,
// fetches their groups once, then per configured group builds a snapshot and
// runs analyze() to produce the metrics the dashboard renders. Writes one file
// per user at docs/data/{slug}.json — a map of String(groupId) -> metrics.
//
// Tokens are NOT stored in configs. They come from process.env.USER_TOKENS
// (a JSON string `{ slug: token }`) or, failing that, the gitignored local
// file secrets/tokens.json. No tokens at all is fatal; per-user / per-group
// failures are logged and skipped so one bad token never aborts the run.
//
// Usage:
//   node build.mjs            build every config (except example.json)
//   node build.mjs <slug>     build only that one slug

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUserGroups, fetchGroupSnapshot } from "./docs/assets/scores-api.mjs";
import { analyze } from "./docs/assets/analyze.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(ROOT, "config");
const DATA_DIR = join(ROOT, "docs", "data");

// Load the { slug: token } map: env first, then secrets/tokens.json. Fatal if neither.
async function loadTokens() {
  if (process.env.USER_TOKENS) {
    try {
      return JSON.parse(process.env.USER_TOKENS);
    } catch (e) {
      console.error(`✖ USER_TOKENS is set but not valid JSON: ${e.message}`);
      process.exit(1);
    }
  }
  try {
    return JSON.parse(await readFile(join(ROOT, "secrets", "tokens.json"), "utf8"));
  } catch {
    console.error("✖ No tokens available. Set USER_TOKENS (a JSON map of { slug: token }) or create secrets/tokens.json.");
    process.exit(1);
  }
}

// Read config/*.json (skipping the example template), optionally filtered to one slug.
async function loadConfigs(onlySlug) {
  const files = (await readdir(CONFIG_DIR)).filter((f) => f.endsWith(".json") && f !== "example.json");
  const configs = [];
  for (const f of files) {
    try {
      const cfg = JSON.parse(await readFile(join(CONFIG_DIR, f), "utf8"));
      if (onlySlug && cfg.slug !== onlySlug) continue;
      configs.push(cfg);
    } catch (e) {
      console.error(`✖ Skipping config ${f}: ${e.message}`);
    }
  }
  return configs;
}

// Build one user: fetch groups once, analyze each configured group, write the map.
async function buildUser(cfg, token) {
  console.error(`• ${cfg.slug} (${cfg.displayName}): ${cfg.groupIds.length} group(s) configured`);

  let groups = [];
  try {
    groups = await fetchUserGroups(token);
  } catch (e) {
    console.error(`  ✖ ${cfg.slug}: could not fetch user groups: ${e.message} — skipping user`);
    return 0;
  }

  const result = {};
  for (const groupId of cfg.groupIds) {
    const meta = groups.find((g) => String(g.groupID) === String(groupId));
    if (!meta) {
      console.error(`  ⚠ ${cfg.slug}: no access to group ${groupId} — skipping`);
      continue;
    }
    try {
      const snap = await fetchGroupSnapshot(token, groupId, meta);
      result[String(groupId)] = analyze(snap);
      console.error(`  ✔ group ${groupId} (${meta.name}): ${snap.leaderboard.length} members`);
    } catch (e) {
      console.error(`  ✖ ${cfg.slug}: group ${groupId} failed: ${e.message} — skipping`);
    }
  }

  // Write keys in sorted order to keep diffs stable.
  const sorted = {};
  for (const k of Object.keys(result).sort()) sorted[k] = result[k];

  await mkdir(DATA_DIR, { recursive: true });
  const outPath = join(DATA_DIR, `${cfg.slug}.json`);

  // Only rewrite when real data changed. Every run stamps a fresh `pulledAt`,
  // which would otherwise make the file differ (and the cron commit) every 15
  // minutes even when no scores/predictions moved. So: compare each group
  // ignoring `pulledAt`, and for any group whose data is identical, keep its
  // previous timestamp — leaving the file byte-for-byte unchanged. `pulledAt`
  // thus reflects "data as of last actual change".
  let existingRaw = null, existing = null;
  try { existingRaw = await readFile(outPath, "utf8"); existing = JSON.parse(existingRaw); } catch { /* first run */ }
  const dataOf = (m) => { const { pulledAt, ...rest } = m || {}; return JSON.stringify(rest); };
  if (existing) {
    for (const k of Object.keys(sorted)) {
      if (existing[k] && dataOf(existing[k]) === dataOf(sorted[k])) sorted[k].pulledAt = existing[k].pulledAt;
    }
  }

  const out = JSON.stringify(sorted, null, 2) + "\n";
  if (out === existingRaw) {
    console.error(`  → ${cfg.slug}.json unchanged (no new data) — left as-is`);
    return Object.keys(sorted).length;
  }
  await writeFile(outPath, out);
  console.error(`  → wrote ${outPath} (${Object.keys(sorted).length} group(s))`);
  return Object.keys(sorted).length;
}

async function main() {
  const onlySlug = process.argv[2] || null;
  const tokens = await loadTokens();
  const configs = await loadConfigs(onlySlug);

  if (!configs.length) {
    console.error(onlySlug ? `✖ No config found for slug "${onlySlug}".` : "✖ No configs found in config/.");
    process.exit(1);
  }

  let usersBuilt = 0, groupsWritten = 0;
  for (const cfg of configs) {
    const token = tokens[cfg.slug];
    if (!token) {
      console.error(`⚠ No token for slug "${cfg.slug}" — skipping user`);
      continue;
    }
    try {
      groupsWritten += await buildUser(cfg, token);
      usersBuilt++;
    } catch (e) {
      console.error(`✖ ${cfg.slug} failed unexpectedly: ${e.message} — skipping`);
    }
  }

  console.error(`\n✔ Done. Built ${usersBuilt}/${configs.length} user(s), ${groupsWritten} group file entr${groupsWritten === 1 ? "y" : "ies"} written.`);
}

main().catch((e) => { console.error("✖ " + e.stack); process.exit(1); });
