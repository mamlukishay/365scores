#!/usr/bin/env node
// One-shot pipeline: pull fresh data → build the dashboard → deploy to Netlify.
//
// Usage:
//   node deploy.mjs                 pull (default group) → graphs → deploy to prod
//   node deploy.mjs --group=17578   pull a specific group
//   node deploy.mjs --headed        show the browser during pull (if login expired)
//   node deploy.mjs --no-pull       skip the data pull, rebuild+deploy newest snapshot
//   node deploy.mjs --no-graphs     skip the build, deploy the newest existing report
//   node deploy.mjs --draft         deploy a preview (not production) URL
//
// First run only: Netlify CLI opens a browser to log in and lets you create/pick a
// site. The chosen site is remembered in ./.netlify/ so later runs are one command.

import { spawn } from "node:child_process";
import { readdir, stat, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir, ROOT } from "./lib/settings.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);

// Run a command, inheriting stdio so prompts/output flow through. Reject on non-zero.
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, cmdArgs, { stdio: "inherit", cwd: ROOT, ...opts });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${cmdArgs.join(" ")} exited ${code}`))
    );
  });
}

// Newest reports/group-* directory inside the data dir, by modification time.
async function newestReport(reportsDir) {
  let entries;
  try {
    entries = await readdir(reportsDir);
  } catch {
    throw new Error(`No reports directory at ${reportsDir}. Run without --no-graphs.`);
  }
  const dirs = [];
  for (const name of entries) {
    if (!name.startsWith("group-")) continue;
    const full = join(reportsDir, name);
    const s = await stat(full);
    if (s.isDirectory()) dirs.push({ full, mtime: s.mtimeMs });
  }
  if (!dirs.length) throw new Error(`No group-* report in ${reportsDir}. Run without --no-graphs.`);
  dirs.sort((a, b) => b.mtime - a.mtime);
  return dirs[0].full;
}

async function main() {
  // Pass-through args for the pull step.
  const pullArgs = args.filter((a) => a.startsWith("--group=") || a === "--headed" || a === "--pick-dir");

  if (!flag("--no-pull")) {
    console.error("\n━━ 1/3  Pulling fresh data ━━");
    await run("node", ["pull.mjs", ...pullArgs]);
  } else {
    console.error("\n━━ 1/3  Skipping data pull (--no-pull) ━━");
  }

  if (!flag("--no-graphs")) {
    console.error("\n━━ 2/3  Building dashboard ━━");
    await run("node", ["infographics.mjs"]);
  } else {
    console.error("\n━━ 2/3  Skipping build (--no-graphs) ━━");
  }

  console.error("\n━━ 3/3  Deploying to Netlify ━━");
  const dataDir = await getDataDir();
  if (!dataDir) throw new Error("No data directory.");
  const reportDir = await newestReport(join(dataDir, "reports"));
  console.error(`• Publishing: ${reportDir}`);

  // Netlify serves index.html at "/"; the dashboard's entry is dashboard.html.
  await copyFile(join(reportDir, "dashboard.html"), join(reportDir, "index.html"));

  const deployArgs = ["--yes", "netlify-cli", "deploy", "--dir", reportDir];
  if (!flag("--draft")) deployArgs.push("--prod");
  // Run from ROOT so .netlify/ (the linked site) persists with the project.
  await run("npx", deployArgs);

  console.error("\n✔ Done.");
}

main().catch((e) => {
  console.error("\n✖ " + (e.stack || e.message));
  process.exit(1);
});
