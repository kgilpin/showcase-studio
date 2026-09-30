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

const SCRIPT = `
ObjC.import("AppKit");
function run(argv) {
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
  const items = $([$.NSURL.fileURLWithPath(argv[0])]);
  const service = $.NSSharingService.sharingServiceNamed($.NSSharingServiceNameSendViaAirDrop);
  if (!service || !service.canPerformWithItems(items)) return "unavailable";
  app.activateIgnoringOtherApps(true);
  service.performWithItems(items);
  const visible = () => {
    const windows = app.windows;
    for (let i = 0; i < windows.count; i++) if (windows.objectAtIndex(i).isVisible) return true;
    return false;
  };
  const loop = $.NSRunLoop.currentRunLoop;
  let seen = false;
  for (let i = 0; i < 1200; i++) {
    loop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.5));
    if (visible()) seen = true;
    else if (seen || i > 20) break;
  }
  return "done";
}`;

/** Whether this machine can AirDrop from the studio server. */
export const canAirDrop = (platform = process.platform) => platform === "darwin";

/** The osascript command that opens the AirDrop window for `file`. */
export function airDropCommand(file) {
  return ["osascript", ["-l", "JavaScript", "-e", SCRIPT, file]];
}

/** Opens the AirDrop window for `file`. Doesn't wait for the user. */
export function airDrop(file) {
  if (!canAirDrop()) throw new Error("AirDrop is only on a Mac");
  const [command, args] = airDropCommand(file);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
