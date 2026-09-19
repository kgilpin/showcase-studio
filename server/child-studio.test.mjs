import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { devStudioArgs, startChildStudio } from "./child-studio.mjs";

/* Stand-ins for scripts/dev.mjs, run as real child processes: what
 * matters is what the child prints, when it exits, and how it stops. */

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function folder() {
  const dir = mkdtempSync(path.join(tmpdir(), "child-studio-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A script that serves /mcp, prints its page the way dev.mjs does, and
 *  leaves a file behind when told to stop. */
function studioScript(dir) {
  const script = path.join(dir, "studio.mjs");
  writeFileSync(
    script,
    `import http from "node:http";
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const server = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const { id, params } = JSON.parse(body);
  const text = JSON.stringify({ tool: params.name, args, cwd: process.cwd() });
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } }));
});
server.listen(0, "127.0.0.1", () => {
  console.error("vite: warming up");
  console.log("studio: http://127.0.0.1:" + server.address().port + "/showcase/nova");
});
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(path.join(dir, "stopped"))}, "");
  process.exit(0);
});
`,
  );
  return script;
}

describe("devStudioArgs", () => {
  it("asks dev.mjs for the same studio, with terminals off and commits off by default", () => {
    const off = ["--no-terminal", "--no-auto-commit"];
    expect(devStudioArgs({ showcasesDir: "/lib", lock: null })).toEqual(["--library=/lib", ...off]);
    expect(
      devStudioArgs({ showcasesDir: "/lib", lock: { kind: "showcase", showcaseId: "nova" } }),
    ).toEqual([`--open=${path.join("/lib", "nova")}`, ...off]);
    expect(devStudioArgs({ showcasesDir: "/lib", lock: { kind: "new" } })).toEqual([
      "--new=/lib",
      ...off,
    ]);
  });

  it("tells dev.mjs not to refuse a taken library when the user chose a second studio", () => {
    expect(devStudioArgs({ showcasesDir: "/lib", lock: null, alongside: true })).toContain(
      "--alongside",
    );
    expect(devStudioArgs({ showcasesDir: "/lib", lock: null })).not.toContain("--alongside");
  });
});

describe("startChildStudio", () => {
  it("starts the script, reaches its tools by address, and stops it", async () => {
    const dir = folder();
    const logged = [];
    const studio = await startChildStudio({
      script: studioScript(dir),
      args: ["--open=/lib/nova"],
      cwd: dir,
      log: (line) => logged.push(line),
    });
    cleanups.push(() => studio.close());

    expect(studio.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(studio.landingUrl()).toBe(`${studio.url}/showcase/nova`);
    // From the studio's own facts once there are some: a New showcase page
    // locks to the showcase created there.
    expect(studio.landingUrl({ lock: { kind: "showcase", showcaseId: "vega" } })).toBe(
      `${studio.url}/showcase/vega`,
    );
    expect(studio.landingUrl({ lock: null })).toBe(studio.url);

    const result = await studio.studio.callTool({ name: "studio_info", arguments: {} });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      tool: "studio_info",
      args: ["--open=/lib/nova"],
    });
    // Its output goes to the log, stderr included — never to stdout.
    expect(logged).toContain("studio: vite: warming up");

    await studio.close();
    expect(existsSync(path.join(dir, "stopped"))).toBe(true);
    await expect(studio.studio.callTool({ name: "studio_info" })).rejects.toMatchObject({
      unreachable: true,
    });
  });

  it("passes on why the studio didn't start when it exits first", async () => {
    const dir = folder();
    const script = path.join(dir, "refuses.mjs");
    writeFileSync(
      script,
      `console.error("A studio already has /lib open, at http://localhost:1. Open that address.");
process.exit(1);
`,
    );
    await expect(startChildStudio({ script, cwd: dir, log: () => {} })).rejects.toThrow(
      /stopped \(exit code 1\):\nA studio already has \/lib open/,
    );
  });

  it("gives up on a studio that never says where it is, and stops it", async () => {
    const dir = folder();
    const script = path.join(dir, "silent.mjs");
    writeFileSync(script, `setInterval(() => {}, 1000);\n`);
    await expect(
      startChildStudio({ script, cwd: dir, log: () => {}, startTimeoutMs: 500 }),
    ).rejects.toThrow(/didn't start within 0.5 s/);
  });
});
