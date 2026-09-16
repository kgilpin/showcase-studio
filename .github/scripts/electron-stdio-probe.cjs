/* CI diagnostics: a bare Electron main process that answers one MCP-style
 * line, to see how Electron's stdin and stdout behave with pipes on this
 * platform. PROBE_MODE picks how it reads and writes:
 *
 *   stdin  process.stdin and process.stdout, as server/mcp-stdio.mjs does
 *   fd     fs streams on file descriptors 0 and 1
 *
 * Run by .github/scripts/mcp-probe.mjs, which sends the line and reports. */
const { app } = require("electron");
const fs = require("node:fs");

const mode = process.env.PROBE_MODE || "stdin";
const log = (text) => {
  try {
    fs.writeSync(2, `${text}\n`);
  } catch {
    /* stderr may be missing too */
  }
};

log(`mode=${mode} platform=${process.platform} stdinTTY=${process.stdin.isTTY}`);
const input = mode === "fd" ? fs.createReadStream(null, { fd: 0 }) : process.stdin;
const write =
  mode === "fd" ? (text) => fs.writeSync(1, text) : (text) => process.stdout.write(text);

let received = "";
input.on("data", (chunk) => {
  received += chunk;
  if (received.includes("\n")) {
    log("got a line");
    write('{"jsonrpc":"2.0","id":1,"result":{}}\n');
  }
});
input.on("end", () => {
  log("stdin ended");
  app.quit();
});
input.on("error", (error) => log(`stdin error: ${error.message}`));
app.whenReady().then(() => log("app ready"));
