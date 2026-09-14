import http from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudio, isLocalRequest } from "./studio-server.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const SHOWCASE_YAML = `meta:
  title: Nova
scenes:
  - id: intro
    theme: statement
    title: Hello
    captions:
      - text: Hi there.
    media:
      kind: image
      asset: shot
`;

function libraryWith(...ids) {
  const library = tempDir("studio-library-");
  for (const id of ids) {
    mkdirSync(path.join(library, id, "assets"), { recursive: true });
    writeFileSync(path.join(library, id, "showcase.yaml"), SHOWCASE_YAML);
  }
  return library;
}

/** A studio on a temp library, mounted in a plain HTTP server on a free
 *  port. Requests the studio doesn't handle answer "app" (the page). */
async function startStudio({ lock = null, features } = {}) {
  const library = libraryWith("nova");
  let saved = {};
  const settings = { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) };
  const studio = createStudio({
    showcasesDir: library,
    lock,
    version: "test",
    srcDir: "/src",
    settings,
    exportDir: tempDir("studio-exports-"),
    features,
    log: () => {},
  });
  const server = http.createServer(
    (req, res) =>
      void studio.handle(req, res, () => {
        res.statusCode = 404;
        res.end("app");
      }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  studio.setUrl(url);
  cleanups.push(async () => {
    await studio.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const post = async (action, body) =>
    (
      await fetch(`${url}/studio/api/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      })
    ).json();
  const info = async () => (await fetch(`${url}/studio/api/info`)).json();
  return { studio, url, library, saved: () => saved, post, info };
}

describe("createStudio", () => {
  it("reports its info, serves the library's files, and passes other requests on", async () => {
    const { url, library, info } = await startStudio();
    expect(await info()).toMatchObject({
      version: "test",
      url,
      library,
      lock: null,
      features: { terminal: true },
    });
    const index = await (await fetch(`${url}/showcase-data/index.json`)).json();
    expect(index.showcases.map((s) => s.id)).toEqual(["nova"]);
    expect(await (await fetch(`${url}/showcase/nova`)).text()).toBe("app");
  });

  it("scaffolds the library and points .studio/mcp.json at itself", async () => {
    const { url, library } = await startStudio();
    expect(existsSync(path.join(library, "README.md"))).toBe(true);
    expect(existsSync(path.join(library, ".studio", "GUIDE.md"))).toBe(true);
    const mcpConfig = JSON.parse(readFileSync(path.join(library, ".studio", "mcp.json"), "utf8"));
    expect(mcpConfig.mcpServers["showcase-studio"].url).toBe(`${url}/mcp`);
  });

  it("writes in-app edits through the scene-edit action", async () => {
    const { library, post } = await startStudio();
    const result = await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "intro",
      field: "title",
      value: "Edited",
    });
    expect(result).toMatchObject({ ok: true });
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8")).toContain(
      "title: Edited",
    );
  });

  it("creates a showcase, and a --new studio locks to the one it creates", async () => {
    const { library, post, info } = await startStudio({ lock: { kind: "new" } });
    expect(await post("showcase-create", { name: "Flow Test" })).toEqual({
      ok: true,
      id: "flow-test",
    });
    expect(existsSync(path.join(library, "flow-test", "showcase.yaml"))).toBe(true);
    expect((await info()).lock).toEqual({ kind: "showcase", showcaseId: "flow-test" });
  });

  it("refuses to create showcases or switch libraries when locked to a showcase", async () => {
    const { post } = await startStudio({ lock: { kind: "showcase", showcaseId: "nova" } });
    expect(await post("showcase-create", { name: "Other" })).toMatchObject({ ok: false });
    expect(await post("library", { dir: libraryWith("other") })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/locked/),
    });
  });

  it("switches libraries and remembers the folder", async () => {
    const { post, info, saved } = await startStudio();
    const other = libraryWith("other");
    expect(await post("library", { dir: other })).toEqual({ ok: true, library: other });
    expect((await info()).library).toBe(other);
    expect(saved()).toMatchObject({ showcasesDir: other, recentFolders: [other] });
    expect(await post("library", { dir: path.join(other, "missing") })).toMatchObject({
      ok: false,
    });
  });

  it("adds, renames, and deletes assets, updating YAML references on rename", async () => {
    const { library, post } = await startStudio();
    const data = Buffer.from("png").toString("base64");
    const files = [{ name: "shot.png", data }];
    expect(await post("asset-add", { showcaseId: "nova", files })).toEqual({
      ok: true,
      names: ["shot.png"],
    });
    expect(await post("asset-add", { showcaseId: "nova", files })).toEqual({
      ok: true,
      names: ["shot-2.png"],
    });
    expect(
      await post("asset-rename", { showcaseId: "nova", from: "shot.png", to: "hero" }),
    ).toEqual({ ok: true, name: "hero.png", updatedReferences: 1 });
    expect(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8")).toContain(
      "asset: hero",
    );
    expect(await post("asset-delete", { showcaseId: "nova", name: "hero.png" })).toEqual({
      ok: true,
    });
    expect(existsSync(path.join(library, "nova", "assets", "hero.png"))).toBe(false);
    expect(await post("asset-delete", { showcaseId: "../nova", name: "x" })).toMatchObject({
      ok: false,
    });
  });

  it("sends info when a page connects, and reload when files change outside the studio", async () => {
    const { url, library } = await startStudio();
    const controller = new AbortController();
    cleanups.push(() => controller.abort());
    const response = await fetch(`${url}/studio/api/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const waitFor = async (text) => {
      while (!received.includes(text)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`the event stream ended before "${text}"`);
        received += decoder.decode(value, { stream: true });
      }
    };
    await waitFor("event: info");
    writeFileSync(path.join(library, "nova", "showcase.yaml"), SHOWCASE_YAML + "\n");
    await waitFor("event: reload");
  }, 10_000);

  it("answers MCP over HTTP: the tool list and studio_info", async () => {
    const { url } = await startStudio();
    const call = async (method, params) =>
      (
        await fetch(`${url}/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        })
      ).json();
    const list = await call("tools/list");
    expect(list.result.tools.map((tool) => tool.name)).toContain("studio_info");
    const studioInfo = await call("tools/call", { name: "studio_info", arguments: {} });
    expect(JSON.parse(studioInfo.result.content[0].text)).toMatchObject({
      url,
      showcases: ["nova"],
    });
  });

  it("runs MCP tools in-process through callTool", async () => {
    const { studio, url } = await startStudio();
    const result = await studio.callTool({ name: "studio_info", arguments: {} });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ url, showcases: ["nova"] });
    const script = await studio.callTool({ name: "script", arguments: { showcaseId: "nova" } });
    expect(script.content[0].text).toContain("NOVA");
  });

  it("exports the narration script as a background job", async () => {
    const { post } = await startStudio();
    const started = await post("export", { kind: "script", showcaseId: "nova" });
    expect(started).toMatchObject({ ok: true, job: { kind: "script", status: "running" } });
    let job = started.job;
    for (let i = 0; job.status === "running" && i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ({ job } = await post("export-status", { jobId: job.jobId }));
    }
    expect(job.status).toBe("done");
    expect(readFileSync(job.out, "utf8")).toContain("NOVA");
    expect(await post("export", { kind: "gif", showcaseId: "nova" })).toMatchObject({
      ok: false,
    });
  });

  it("turns the embedded terminals off when asked", async () => {
    const { post, info } = await startStudio({ features: { terminal: false } });
    expect((await info()).features).toEqual({ terminal: false });
    expect(await post("terminal-available")).toEqual({ ptyReady: false, claude: false });
    expect(await post("terminal-start", { id: "nova", cols: 80, rows: 24 })).toMatchObject({
      ok: false,
    });
  });

  it("refuses API requests addressed to another host name", async () => {
    const { url } = await startStudio();
    const { port } = new URL(url);
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: "/studio/api/info", headers: { host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});

describe("isLocalRequest", () => {
  const request = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers });

  it("accepts requests made on this machine to a local host name", () => {
    expect(isLocalRequest(request("127.0.0.1", { host: "localhost:5173" }))).toBe(true);
    expect(isLocalRequest(request("::1", { host: "[::1]:5173" }))).toBe(true);
    expect(
      isLocalRequest(
        request("::ffff:127.0.0.1", { host: "127.0.0.1:1", origin: "http://localhost:1" }),
      ),
    ).toBe(true);
  });

  it("refuses other machines, other host names, and pages from other sites", () => {
    expect(isLocalRequest(request("192.168.1.5", { host: "localhost:5173" }))).toBe(false);
    expect(isLocalRequest(request("127.0.0.1", { host: "evil.example:5173" }))).toBe(false);
    expect(
      isLocalRequest(request("127.0.0.1", { host: "localhost:1", origin: "https://evil.example" })),
    ).toBe(false);
  });
});
