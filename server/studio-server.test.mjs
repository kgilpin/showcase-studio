import http from "node:http";
import { Readable } from "node:stream";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import { contentHash } from "./scene-edit.mjs";
import { createStudio, isLocalRequest } from "./studio-server.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  /* Retries: on Windows a folder can't be removed while the studio's
   * watcher or a git process still has it open, which lasts a moment. */
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }),
  );
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
async function startStudio({
  lock = null,
  features,
  srcDir = "/src",
  ids = ["nova"],
  before,
} = {}) {
  const library = libraryWith(...ids);
  before?.(library);
  let saved = {};
  const settings = { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) };
  const studio = createStudio({
    showcasesDir: library,
    lock,
    version: "test",
    srcDir,
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

  it("writes no launch.json, and removes the ones an earlier studio wrote", async () => {
    const own = '{ "version": "0.0.1", "configurations": [] }\n';
    const written =
      '// Written by Showcase Studio — rewritten on every launch.\n{ "version": "0.0.1" }\n';
    const place = (library, id, content, extra) => {
      mkdirSync(path.join(library, id, ".claude"), { recursive: true });
      writeFileSync(path.join(library, id, ".claude", "launch.json"), content);
      if (extra) writeFileSync(path.join(library, id, ".claude", extra), "{}\n");
    };
    const { library, post } = await startStudio({
      ids: ["nova", "flow", "orbit"],
      before: (dir) => {
        place(dir, "nova", written);
        place(dir, "flow", written, "settings.local.json");
        place(dir, "orbit", own);
      },
    });

    /* Its own files go, and an emptied .claude folder with them. */
    expect(existsSync(path.join(library, "nova", ".claude"))).toBe(false);
    expect(existsSync(path.join(library, "flow", ".claude", "launch.json"))).toBe(false);
    expect(existsSync(path.join(library, "flow", ".claude", "settings.local.json"))).toBe(true);
    /* The user's own file stays. */
    expect(readFileSync(path.join(library, "orbit", ".claude", "launch.json"), "utf8")).toBe(own);
    expect(readFileSync(path.join(library, ".gitignore"), "utf8")).not.toContain("launch.json");

    /* A new showcase gets none. */
    expect(await post("showcase-create", { name: "Comet" })).toEqual({ ok: true, id: "comet" });
    expect(existsSync(path.join(library, "comet", ".claude"))).toBe(false);
  });

  it("points the guide at the app's source only when the source is there", async () => {
    const guideOf = (library) => readFileSync(path.join(library, ".studio", "GUIDE.md"), "utf8");

    /* The packaged app: srcDir holds only the modules the app runs. */
    const packaged = await startStudio();
    expect(guideOf(packaged.library)).toContain("source isn't installed with the app");
    expect(guideOf(packaged.library)).not.toContain("complete source");

    /* From source: the repo, with src/components/ in it. */
    const repo = process.cwd();
    const fromSource = await startStudio({ srcDir: repo });
    expect(guideOf(fromSource.library)).toContain(`complete source is at ${repo}`);
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

  it("renames only references to the renamed asset, leaving a missing asset's alone", async () => {
    const yaml = `meta:
  title: Nova
scenes:
  - id: plugin
    theme: feature
    title: Plugin
    captions:
      - text: One.
    media:
      kind: image
      asset: shot-claude-desktop
  - id: take
    theme: footage
    title: Take
    captions:
      - text: Two.
    media:
      kind: video
      asset: showcase-studio-take-2
`;
    for (const to of ["video-readthrough-13sec.mp4", "video-readthrough-13sec"]) {
      const { library, post } = await startStudio();
      const yamlPath = path.join(library, "nova", "showcase.yaml");
      writeFileSync(yamlPath, yaml);
      writeFileSync(path.join(library, "nova", "assets", "showcase-studio-take-2.mp4"), "mp4");
      expect(
        await post("asset-rename", { showcaseId: "nova", from: "showcase-studio-take-2.mp4", to }),
      ).toEqual({ ok: true, name: "video-readthrough-13sec.mp4", updatedReferences: 1 });
      expect(readFileSync(yamlPath, "utf8")).toBe(
        yaml.replace("asset: showcase-studio-take-2", "asset: video-readthrough-13sec"),
      );
      expect(existsSync(path.join(library, "nova", "assets", "video-readthrough-13sec.mp4"))).toBe(
        true,
      );
    }
  });

  it("rewrites a shared bare name only when it means the renamed file", async () => {
    /* shot.mp4 and shot.png share "shot", which means shot.mp4 (the first). */
    const yaml = `meta:
  title: Nova
scenes:
  - id: one
    theme: footage
    captions:
      - text: One.
    media:
      kind: video
      asset: shot
  - id: two
    theme: feature
    captions:
      - text: Two.
    media:
      kind: image
      asset: shot.png
`;
    /* The files are written before the studio starts, so its watcher sees
     * no setup writes and the recording is the same on every run. */
    const setup = async (...files) => {
      const studio = await startStudio({
        before: (library) => {
          writeFileSync(path.join(library, "nova", "showcase.yaml"), yaml);
          for (const file of files) {
            writeFileSync(path.join(library, "nova", "assets", file), "x");
          }
        },
      });
      return { ...studio, yamlPath: path.join(studio.library, "nova", "showcase.yaml") };
    };
    /* Through handle, not a real request, as the other gold-traced tests
     * do: the recorder can't nest a real HTTP request under its handler. */
    const rename = async ({ studio }, body) =>
      (
        await handleDirectly(studio, {
          method: "POST",
          url: "/studio/api/asset-rename",
          body: { showcaseId: "nova", ...body },
        })
      ).json();

    /* Renaming the file "shot" doesn't mean leaves the bare key alone. */
    const png = await setup("shot.mp4", "shot.png");
    expect(await rename(png, { from: "shot.png", to: "still" })).toMatchObject({
      ok: true,
      name: "still.png",
      updatedReferences: 1,
    });
    expect(readFileSync(png.yamlPath, "utf8")).toBe(
      yaml.replace("asset: shot.png", "asset: still.png"),
    );

    /* A new bare name that already means another file gets the full name. */
    const mp4 = await setup("shot.mp4", "shot.png", "clip.png");
    expect(await rename(mp4, { from: "shot.mp4", to: "clip" })).toMatchObject({
      ok: true,
      name: "clip.mp4",
      updatedReferences: 1,
    });
    expect(readFileSync(mp4.yamlPath, "utf8")).toBe(
      yaml.replace("asset: shot\n", "asset: clip.mp4\n"),
    );
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

  it("reports the last page error in studio_info until a page renders", async () => {
    const { studio } = await startStudio();
    const studioInfo = async () =>
      JSON.parse((await studio.callTool({ name: "studio_info", arguments: {} })).content[0].text);
    cleanups.push(() => clearPageError());

    expect(await studioInfo()).not.toHaveProperty("pageError");
    recordPageError(new Error("Cannot find module '@/content/showcases'"), {
      path: "/showcase/nova",
    });
    expect((await studioInfo()).pageError).toMatchObject({
      message: "Cannot find module '@/content/showcases'",
      path: "/showcase/nova",
      at: expect.any(String),
      stack: expect.stringContaining("at "),
    });
    /* What src/server.ts does when a later page renders. */
    clearPageError();
    expect(await studioInfo()).not.toHaveProperty("pageError");
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

/** The library's change log, parsed. */
const changesIn = (library) =>
  readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

describe("the change log", () => {
  it("logs each page edit in edit_showcase's shape, with the file's versions", async () => {
    const { library, post } = await startStudio();
    const file = path.join(library, "nova", "showcase.yaml");
    const before = contentHash(readFileSync(file));
    const title = await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "intro",
      field: "title",
      value: "Edited",
      baseHash: before,
    });
    const caption = await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "intro",
      field: "caption",
      captionIndex: 0,
      value: "A new line.",
    });
    await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "",
      field: "theme",
      group: "colors",
      name: "caption-text",
      value: "#ffd166",
    });
    /* A refused edit wrote nothing, so it isn't logged. */
    const refused = await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "intro",
      field: "title",
      value: "Lost",
      baseHash: before,
    });
    expect(refused).toMatchObject({ ok: false, stale: true });

    const raw = readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8");
    expect(raw).toMatch(/^\{"at":"[^"]+","source":"ui","showcaseId":"nova","kind":"edit",/);
    expect(changesIn(library)).toEqual([
      {
        at: expect.any(String),
        source: "ui",
        showcaseId: "nova",
        kind: "edit",
        file: "showcase.yaml",
        previousVersion: before,
        version: title.hash,
        edits: [{ field: "scene.set", sceneId: "intro", name: "title", value: "Edited" }],
      },
      expect.objectContaining({
        previousVersion: title.hash,
        version: caption.hash,
        edits: [
          {
            field: "caption.set",
            sceneId: "intro",
            captionIndex: 0,
            name: "text",
            value: "A new line.",
          },
        ],
      }),
      expect.objectContaining({
        file: "theme.yaml",
        previousVersion: null,
        edits: [{ field: "theme", group: "colors", name: "caption-text", value: "#ffd166" }],
      }),
    ]);
  });

  it("logs an asset rename with every reference it rewrote, and leaves other assets alone", async () => {
    const { library, post } = await startStudio();
    const file = path.join(library, "nova", "showcase.yaml");
    writeFileSync(
      file,
      `meta:
  title: Nova
  cover: "take-2.mp4"
scenes:
  - id: setup
    theme: footage
    captions:
      - text: Cut from take-2.
    media:
      kind: video
      asset: take-2
  - id: claude
    theme: feature
    captions:
      - text: A placeholder until the capture lands.
    media:
      kind: image
      asset: shot-claude-desktop
  - id: outro
    theme: footage
    captions:
      - text: Bye.
    media:
      kind: video
      asset: 'take-2' # the last clip
`,
    );
    writeFileSync(path.join(library, "nova", "assets", "take-2.mp4"), "mp4");
    const before = contentHash(readFileSync(file));

    expect(
      await post("asset-rename", { showcaseId: "nova", from: "take-2.mp4", to: "readthrough" }),
    ).toEqual({ ok: true, name: "readthrough.mp4", updatedReferences: 3 });

    const after = readFileSync(file, "utf8");
    expect(after).toContain('cover: "readthrough.mp4"');
    expect(after).toContain("asset: 'readthrough' # the last clip");
    /* A scene pointing at another asset — even a missing one — is untouched,
     * and so is narration that mentions the old name. */
    expect(after).toContain("asset: shot-claude-desktop");
    expect(after).toContain("text: Cut from take-2.");

    expect(changesIn(library)).toEqual([
      {
        at: expect.any(String),
        source: "ui",
        showcaseId: "nova",
        kind: "asset.rename",
        from: "take-2.mp4",
        to: "readthrough.mp4",
        references: [
          { path: "meta.cover", from: "take-2.mp4", to: "readthrough.mp4" },
          { path: "scenes.0.media.asset", sceneId: "setup", from: "take-2", to: "readthrough" },
          { path: "scenes.2.media.asset", sceneId: "outro", from: "take-2", to: "readthrough" },
        ],
        file: "showcase.yaml",
        previousVersion: before,
        version: contentHash(after),
      },
    ]);
  });

  it("logs asset uploads, deletes, and new showcases — and nothing for a failed action", async () => {
    const { library, post } = await startStudio();
    const files = [{ name: "extra.png", data: Buffer.from("png").toString("base64") }];
    await post("asset-add", { showcaseId: "nova", files });
    await post("asset-rename", { showcaseId: "nova", from: "extra.png", to: "spare.png" });
    await post("asset-delete", { showcaseId: "nova", name: "missing.png" });
    await post("asset-delete", { showcaseId: "nova", name: "spare.png" });
    await post("showcase-create", { name: "Flow Test" });
    expect(changesIn(library).map(({ at: _at, ...entry }) => entry)).toEqual([
      { source: "ui", showcaseId: "nova", kind: "asset.add", names: ["extra.png"] },
      /* Nothing referenced it, so showcase.yaml didn't change: no versions. */
      {
        source: "ui",
        showcaseId: "nova",
        kind: "asset.rename",
        from: "extra.png",
        to: "spare.png",
        references: [],
      },
      { source: "ui", showcaseId: "nova", kind: "asset.delete", name: "spare.png" },
      { source: "ui", showcaseId: "flow-test", kind: "showcase.create", title: "Flow Test" },
    ]);
  });

  it("edit_showcase returns a version, and refuses a stale ifVersion with the UI edits since", async () => {
    const { studio, library } = await startStudio();
    const file = path.join(library, "nova", "showcase.yaml");

    const read = await studio.callTool({
      name: "read_showcase",
      arguments: { showcaseId: "nova" },
    });
    const { version, changes } = JSON.parse(read.content[0].text);
    expect(version).toBe(contentHash(readFileSync(file)));
    expect(changes).toBe(path.join(library, ".studio", "changes.jsonl"));
    expect(read.content[1].text).toBe(readFileSync(file, "utf8"));

    const edited = await studio.callTool({
      name: "edit_showcase",
      arguments: {
        showcaseId: "nova",
        ifVersion: version,
        edits: [{ field: "scene.set", sceneId: "intro", name: "eyebrow", value: "One" }],
      },
    });
    const { applied, version: claudeVersion } = JSON.parse(edited.content[0].text);
    expect(applied).toBe(1);
    expect(claudeVersion).toBe(contentHash(readFileSync(file)));

    /* The user changes a caption in the studio. Driven through handle,
     * like the other gold-traced tests: the recorder can't nest a real
     * HTTP request under its handler, and the trace won't sanitize. */
    await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/scene-edit",
      body: {
        showcaseId: "nova",
        sceneId: "intro",
        field: "caption",
        captionIndex: 0,
        value: "Changed in the studio.",
      },
    });
    const afterUi = readFileSync(file, "utf8");

    const refused = await studio
      .callTool({
        name: "edit_showcase",
        arguments: {
          showcaseId: "nova",
          ifVersion: claudeVersion,
          edits: [{ field: "scene.set", sceneId: "intro", name: "title", value: "From Claude" }],
        },
      })
      .catch((error) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused.message).toContain("nothing was written");
    expect(refused.message).toContain("The studio logged these changes since then");
    expect(refused.message).toContain('"source":"ui"');
    expect(refused.message).toContain("Changed in the studio.");
    expect(refused.message).not.toContain('"source":"mcp"'); // Claude's own edit came before
    expect(refused.message).toContain(`The current version is ${contentHash(afterUi)}`);
    expect(readFileSync(file, "utf8")).toBe(afterUi);
    expect(changesIn(library).map((entry) => entry.source)).toEqual(["mcp", "ui"]);
  });

  it("says so when showcase.yaml changed outside the studio", async () => {
    const { studio, library } = await startStudio();
    const file = path.join(library, "nova", "showcase.yaml");
    const version = contentHash(readFileSync(file));
    writeFileSync(file, SHOWCASE_YAML.replace("Hello", "Hand edited"));
    const refused = await studio
      .callTool({
        name: "edit_showcase",
        arguments: {
          showcaseId: "nova",
          ifVersion: version,
          edits: [{ field: "scene.set", sceneId: "intro", name: "title", value: "From Claude" }],
        },
      })
      .catch((error) => error);
    expect(refused.message).toContain("changed outside the studio");
    expect(readFileSync(file, "utf8")).toContain("Hand edited");
  });
});

/** Calls studio.handle directly with in-memory request and response
 *  objects: the studio's routing, gates, and actions with no network in
 *  between. */
async function handleDirectly(
  studio,
  { method = "GET", url, body, host = "localhost:5173", remoteAddress = "127.0.0.1" },
) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {
    method,
    url,
    headers: { host, "content-type": "application/json" },
    socket: { remoteAddress },
  });
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      writeHead(status) {
        this.statusCode = status;
        this.headersSent = true;
      },
      write() {},
      end(chunk) {
        this.headersSent = true;
        resolve({ status: this.statusCode, json: () => JSON.parse(String(chunk)) });
      },
    };
    void studio.handle(req, res, () => resolve({ status: 0, json: () => undefined }));
  });
}

describe("studio.handle, called directly", () => {
  it("runs a page action: scene-edit through the local-request gate to the YAML write", async () => {
    const { studio, library } = await startStudio();
    const result = await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/scene-edit",
      body: { showcaseId: "nova", sceneId: "intro", field: "title", value: "Edited directly" },
    });
    expect(result.status).toBe(200);
    expect(result.json()).toMatchObject({ ok: true });
    expect(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8")).toContain(
      "title: Edited directly",
    );
  });

  it("refuses a request for another host name before any action runs", async () => {
    const { studio, library } = await startStudio();
    const result = await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/showcase-create",
      body: { name: "Sneaky" },
      host: "evil.example",
    });
    expect(result.status).toBe(403);
    expect(existsSync(path.join(library, "sneaky"))).toBe(false);
  });

  it("refuses to create a showcase or switch libraries when locked to a showcase", async () => {
    const { studio } = await startStudio({ lock: { kind: "showcase", showcaseId: "nova" } });
    const created = await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/showcase-create",
      body: { name: "Other" },
    });
    const switched = await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/library",
      body: { dir: libraryWith("other") },
    });
    expect(created.json()).toMatchObject({ ok: false });
    expect(switched.json()).toMatchObject({ ok: false, error: expect.stringMatching(/locked/) });
  });
});

describe("the library's files", () => {
  it("are served to this machine and refused to another host name", async () => {
    const { studio } = await startStudio();
    const local = await handleDirectly(studio, { url: "/showcase-data/index.json" });
    expect(local.status).toBe(200);
    expect(local.json().showcases.map((s) => s.id)).toEqual(["nova"]);
    const remote = await handleDirectly(studio, {
      url: "/showcase-data/nova/showcase.yaml",
      host: "evil.example",
    });
    expect(remote.status).toBe(403);
    expect(remote.json()).toMatchObject({ ok: false });
  });

  it("are refused to a request from another machine", async () => {
    const { studio } = await startStudio();
    const result = await handleDirectly(studio, {
      url: "/showcase-data/index.json",
      remoteAddress: "192.168.1.5",
    });
    expect(result.status).toBe(403);
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
