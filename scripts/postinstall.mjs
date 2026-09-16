/* Runs after `npm install`. npm strips the exec bit from node-pty's
 * spawn-helper, which macOS and Linux need to start a terminal. Windows has
 * no spawn-helper and no exec bit, so there is nothing to do there.
 *
 * A Node script rather than a shell one-liner: npm runs install scripts
 * with cmd.exe on Windows, which knows neither chmod nor 2>/dev/null. */
import { chmodSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  const prebuilds = path.join("node_modules", "node-pty", "prebuilds");
  for (const platform of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
    const helper = path.join(prebuilds, platform, "spawn-helper");
    try {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    } catch {
      /* Not ours to fail an install over; a terminal just won't start. */
    }
  }
}
