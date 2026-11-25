/* Run by airdrop.mjs as `osascript -l JavaScript airdrop.jxa.js <file>`.
 * JavaScript for Automation, not Node: ObjC and $ are osascript's.
 * Opens the AirDrop window for the file and keeps running while it is
 * open, for at most ten minutes. Prints "done" or "unavailable". */
/* global ObjC, $ */
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
}
