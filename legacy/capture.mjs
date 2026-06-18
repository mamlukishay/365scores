#!/usr/bin/env node
// 365Scores Predictions Cup — network capture.
//
// Launches a real Chromium with a persistent profile (log in once), records
// every JSON response from 365scores hosts while you browse into your group,
// then saves a timestamped snapshot into your chosen data directory.
//
// Usage:
//   node capture.mjs                       open homepage, navigate manually
//   node capture.mjs "https://...group"    go straight to a known group URL
//   node capture.mjs --headless            run without a visible window (only
//                                          works once you're already logged in)

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import readline from "node:readline";
import { ROOT } from "./lib/settings.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const startUrl = args.find((a) => a.startsWith("http")) || "https://www.365scores.com/";
const HEADLESS = flag("--headless");
const PROFILE_DIR = join(ROOT, ".browser-profile");
// Raw captures live in a project-local, gitignored dir — no folder picker.
const REPORTS_DIR = join(ROOT, "reports");

// Only keep responses from 365scores APIs; ignore images/fonts/3rd-party noise.
const HOST_RE = /365scores\.com/i;

function waitForEnter(promptText) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(promptText, () => { rl.close(); resolve(); }));
}

async function main() {
  console.error(`• Reports directory: ${REPORTS_DIR}`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: HEADLESS,
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  // url+method -> { url, method, status, contentType, body, at }
  const captured = new Map();
  context.on("response", async (resp) => {
    try {
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const url = resp.url();
      if (!HOST_RE.test(url)) return;
      const body = await resp.json();
      const req = resp.request();
      captured.set(`${req.method()} ${url}`, {
        url,
        method: req.method(),
        status: resp.status(),
        contentType: ct,
        at: new Date().toISOString(),
        body,
      });
      const path = new URL(url).pathname;
      console.error(`  ↳ captured ${resp.status()} ${path} (${captured.size} total)`);
    } catch { /* non-JSON or body unavailable — skip */ }
  });

  const page = context.pages()[0] || (await context.newPage());
  console.error(`• Opening ${startUrl}`);
  await page.goto(startUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  console.error("\n──────────────────────────────────────────────");
  console.error(" In the browser window:");
  console.error("   1. Log in if needed (this profile is remembered).");
  console.error("   2. Open your Predictions Cup group / leaderboard.");
  console.error("   3. Click around so all the data loads.");
  console.error(" Endpoints are being captured live (see ↳ lines above).");
  console.error("──────────────────────────────────────────────");
  await waitForEnter("\n▶ Press ENTER here when you're done to save the snapshot... ");

  const items = [...captured.values()];
  if (!items.length) {
    console.error("✖ No JSON captured. Did the group page load? Nothing saved.");
    await context.close();
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapDir = join(REPORTS_DIR, "snapshots");
  await mkdir(snapDir, { recursive: true });
  const outPath = join(snapDir, `snapshot-${stamp}.json`);
  await writeFile(outPath, JSON.stringify({ capturedAt: stamp, count: items.length, responses: items }, null, 2));

  // Lightweight index of what endpoints we've seen, for quick scanning.
  console.error(`\n✔ Saved ${items.length} responses → ${outPath}\n`);
  console.error("  Endpoints captured:");
  for (const it of items) {
    const p = new URL(it.url).pathname + new URL(it.url).search;
    console.error(`   • ${it.method} ${p.slice(0, 120)}`);
  }

  await context.close();
}

main().catch((e) => { console.error("✖ " + e.stack); process.exit(1); });
