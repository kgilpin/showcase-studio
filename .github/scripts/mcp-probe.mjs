/* CI diagnostics for the plugin's MCP server on Windows: starts one command
 * the way an MCP client does (Node's spawn, stdin and stdout as pipes),
 * sends an MCP initialize request, and prints what came back — the reply,
 * the error output, and the exit code. Never fails the job; it reports.
 *
 *   node .github/scripts/mcp-probe.mjs <label> <command> [args...]
 *
 * Set PROBE_SHELL=1 to spawn through a shell, as some clients do. */
import { spawn } from "node:child_process";

const [label, command, ...args] = process.argv.slice(2);
const shell = process.env.PROBE_SHELL === "1";
console.log(`=== ${label}: ${command} ${args.join(" ")}${shell ? " (shell)" : ""}`);

let child;
try {
  child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], shell, windowsHide: true });
} catch (error) {
  console.log(`spawn threw: ${error.message}`);
  process.exit(0);
}

let stdout = "";
let stderr = "";
let replied = false;
child.stdout.on("data", (chunk) => {
  stdout += chunk;
  if (stdout.includes('"id":1')) replied = true;
});
child.stderr.on("data", (chunk) => (stderr += chunk));
child.on("error", (error) => console.log(`spawn error: ${error.message}`));

const request = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "probe", version: "1" },
  },
};
child.stdin.on("error", (error) => console.log(`stdin error: ${error.message}`));
child.stdin.write(JSON.stringify(request) + "\n");

const done = new Promise((resolve) =>
  child.on("exit", (code, signal) => resolve({ code, signal })),
);
const deadline = Date.now() + 45_000;
while (!replied && child.exitCode === null && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 250));
}
const exited = child.exitCode !== null;
if (!exited) child.kill();
const { code, signal } = exited ? await done : { code: null, signal: "killed by probe" };

console.log(`replied: ${replied}`);
console.log(`exit: ${exited ? code : `still running (${signal})`}`);
console.log(`stdout (first 600 chars): ${stdout.slice(0, 600) || "(none)"}`);
console.log(`stderr (last 1500 chars): ${stderr.slice(-1500) || "(none)"}`);
process.exit(0);
