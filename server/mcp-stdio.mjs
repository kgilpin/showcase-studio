/* Connects a Claude Code session to a running studio's MCP tools, with no
 * port to configure. Claude Code starts this script over stdio (the repo's
 * .mcp.json). It answers the handshake and the tool list itself and
 * forwards each tool call to the newest running studio: every studio
 * lists itself in the studio data folder (running/<pid>.json) while it
 * runs. With no studio running, a tool call says how to start one — so the
 * bridge connects even when the studio starts later. */
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createMcpRpc } from "./mcp.mjs";
import { studioDataDir } from "./settings.mjs";

const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;

/** Running studios, newest first. Entries whose process is gone are
 *  removed as they're found. */
export function runningStudios(registryDir = path.join(studioDataDir(), "running")) {
  if (!existsSync(registryDir)) return [];
  const studios = [];
  for (const name of readdirSync(registryDir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(registryDir, name);
    try {
      const entry = JSON.parse(readFileSync(file, "utf8"));
      process.kill(entry.pid, 0);
      studios.push(entry);
    } catch (error) {
      if (error?.code === "ESRCH") rmSync(file, { force: true });
      if (error?.code === "EPERM") continue; // alive, but not ours to signal
    }
  }
  return studios.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

async function forwardToolCall(params) {
  const [studio] = runningStudios();
  if (!studio?.url) {
    throw new Error(
      "No Showcase Studio is running. Start one from the studio repo with " +
        "`npm run dev:claude` (or `npm run dev`), then try again.",
    );
  }
  const response = await fetch(`${studio.url}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }),
  });
  const reply = await response.json();
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
}

const rpc = createMcpRpc({ version, callTool: forwardToolCall });

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }) + "\n",
    );
    return;
  }
  const reply = await rpc(message);
  if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
});
