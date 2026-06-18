#!/usr/bin/env node
// Build infographics from a pulled snapshot: an interactive HTML dashboard
// plus a PNG of each chart (rendered headlessly via the vendored Chart.js).
//
// Usage:
//   node infographics.mjs                  use the newest group-*-latest.json
//   node infographics.mjs /path/snap.json  use a specific snapshot
//   node infographics.mjs --open           open the dashboard when done

import { chromium } from "playwright";
import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { getDataDir, ROOT } from "./lib/settings.mjs";
import { loadSnapshot, analyze } from "./lib/analyze.mjs";
import { renderHTML } from "./lib/dashboard.mjs";

const args = process.argv.slice(2);
const explicit = args.find((a) => a.startsWith("/") || a.endsWith(".json"));
const OPEN = args.includes("--open");

// Asset files the dashboard needs (copied next to the report).
const ASSET_FILES = [
  "chart.umd.min.js", "chartjs-plugin-datalabels.min.js", "countUp.umd.js",
  "confetti.browser.js", "dashboard.css", "dashboard.js",
];

// Cards/sections to capture as standalone PNGs.
const CARDS = [
  ["podium", "podium"],
  ["statCards", "player-card"],
  ["awards", "awards"],
  ["card-perf", "leaderboard"],
  ["card-region", "by-region"],
  ["card-race", "race"],
  ["card-style", "playing-style"],
  ["card-acc", "accuracy"],
  ["card-bestdays", "best-days"],
  ["card-nemesis", "nemesis"],
  ["card-banker", "bankers"],
  ["card-sim", "similarity"],
];

async function newestLatest(snapDir) {
  const files = (await readdir(snapDir)).filter((f) => /-latest\.json$/.test(f));
  if (!files.length) throw new Error(`No *-latest.json snapshot in ${snapDir}. Run: node pull.mjs`);
  return join(snapDir, files.sort().reverse()[0]);
}

async function main() {
  const dataDir = await getDataDir();
  if (!dataDir) { console.error("✖ No data directory."); process.exit(1); }
  const snapDir = join(dataDir, "snapshots");
  const snapPath = explicit || (await newestLatest(snapDir));
  console.error(`• Snapshot: ${snapPath}`);

  const snap = await loadSnapshot(snapPath);
  const metrics = analyze(snap);
  console.error(`• ${metrics.standings.length} players · ${metrics.finishedCount}/${metrics.totalGames} matches played`);

  // Output dir: reports/<group>-<stamp>/ inside the chosen data dir.
  const stamp = (metrics.pulledAt || new Date().toISOString()).replace(/[:.]/g, "-");
  const outDir = join(dataDir, "reports", `group-${metrics.group?.groupID}-${stamp}`);
  await mkdir(join(outDir, "assets"), { recursive: true });
  await mkdir(join(outDir, "charts"), { recursive: true });
  for (const f of ASSET_FILES) await copyFile(join(ROOT, "assets", f), join(outDir, "assets", f));

  const html = renderHTML(metrics, { assets: "./assets" });
  const htmlPath = join(outDir, "dashboard.html");
  await writeFile(htmlPath, html);

  // Render headlessly and screenshot each card + the full page.
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("file://" + htmlPath + "?static=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(900); // let charts settle
  if (pageErrors.length) console.error("  ⚠ page errors:\n    " + pageErrors.join("\n    "));

  for (const [id, name] of CARDS) {
    const el = page.locator("#" + id);
    try {
      await el.screenshot({ path: join(outDir, "charts", name + ".png"), timeout: 5000 });
      console.error(`  ✓ charts/${name}.png`);
    } catch {
      console.error(`  ✗ ${name} (#${id}) not captured`);
    }
  }
  await page.screenshot({ path: join(outDir, "dashboard-full.png"), fullPage: true });
  await browser.close();

  console.error(`\n✔ Report written to:\n  ${outDir}`);
  console.error(`  • dashboard.html  (interactive)\n  • dashboard-full.png\n  • charts/*.png`);

  if (OPEN) execFile("open", [htmlPath]);
}

main().catch((e) => { console.error("✖ " + e.stack); process.exit(1); });
