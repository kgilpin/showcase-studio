/* The studio's persisted settings: settings.json in the studio's data
 * folder — the chosen library, recent folders, prompter tokens, and which
 * showcases' terminals ran before. Plain Node, so every mode (the dev
 * servers and the packaged app) shares one file. The folder is the one
 * Electron uses for an app named "Showcase Studio" (its userData), so
 * settings saved by earlier desktop builds carry over. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_NAME = "Showcase Studio";

/** The studio's data folder: settings, the speech model, and the list of
 *  running studios. */
export function studioDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), APP_NAME);
}

const settingsPath = () => path.join(studioDataDir(), "settings.json");

export function loadSettings() {
  try {
    return JSON.parse(readFileSync(settingsPath(), "utf8"));
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const settings = { ...loadSettings(), ...patch };
  mkdirSync(path.dirname(settingsPath()), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
  return settings;
}
