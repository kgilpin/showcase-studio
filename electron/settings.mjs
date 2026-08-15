/* Tiny persisted settings for the shell (userData/settings.json). */
import { app } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

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
