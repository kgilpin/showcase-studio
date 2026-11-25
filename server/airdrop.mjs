/* AirDrop from the studio server, on a Mac — so "Send to phone" works in
 * every place the Share page runs: the desktop window, a browser, and
 * Claude Code's preview panel. None of those can reach macOS's sharing
 * services from the page, but the studio server runs on the same Mac.
 *
 * It runs a small JavaScript for Automation script with osascript: the
 * script asks macOS's AirDrop sharing service to send the file, which
 * opens the AirDrop window, and keeps running while that window is open
 * (the window closes when the script ends). It gives up after ten
 * minutes. Nothing is sent until the user picks a device in the window. */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(new URL("./airdrop.jxa.js", import.meta.url));

/** Whether this machine can AirDrop from the studio server. */
export const canAirDrop = (platform = process.platform) => platform === "darwin";

/** The osascript command that opens the AirDrop window for `file`. */
export function airDropCommand(file) {
  return ["osascript", ["-l", "JavaScript", SCRIPT_FILE, file]];
}

/** Opens the AirDrop window for `file`. Doesn't wait for the user. */
export function airDrop(file) {
  if (!canAirDrop()) throw new Error("AirDrop is only on a Mac");
  const [command, args] = airDropCommand(file);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
