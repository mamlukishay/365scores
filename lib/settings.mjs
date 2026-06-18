// Settings + native macOS folder picker.
// The chosen data directory is remembered in app-settings.json so later
// runs don't re-prompt (pass --pick-dir to force the dialog again).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFileP = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SETTINGS_PATH = join(ROOT, "app-settings.json");

export { ROOT };

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function loadSettings() {
  try { return JSON.parse(await readFile(SETTINGS_PATH, "utf8")); }
  catch { return {}; }
}

async function saveSettings(s) {
  await writeFile(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

// Native "choose folder" dialog via AppleScript. Returns absolute POSIX path,
// or null if the user cancels.
export async function pickFolder(prompt = "Select a folder to store 365Scores data") {
  const script = `POSIX path of (choose folder with prompt ${JSON.stringify(prompt)})`;
  try {
    const { stdout } = await execFileP("osascript", ["-e", script]);
    return stdout.trim().replace(/\/$/, "");
  } catch (e) {
    if (/User canceled|-128/.test(e.stderr || e.message)) return null;
    throw e;
  }
}

// Resolve the data directory: reuse the saved one unless forced or missing.
export async function getDataDir({ force = false } = {}) {
  const s = await loadSettings();
  if (!force && s.dataDir && (await exists(s.dataDir))) return s.dataDir;

  const picked = await pickFolder();
  if (!picked) return null;
  s.dataDir = picked;
  await saveSettings(s);
  return picked;
}
