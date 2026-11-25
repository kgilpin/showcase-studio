import { execFileSync } from "node:child_process";
import http from "node:http";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publish } from "../cdk/lambda/publish-core.mjs";
import { VIDEO_FORMATS } from "../src/lib/export-kinds.mjs";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import { createExportRecords } from "./export-records.mjs";
import { contentHash } from "./scene-edit.mjs";
import { changesByShowcase, createStudio, isLocalRequest } from "./studio-server.mjs";
import { whisperPath } from "./transcribe.mjs";

/* Pin the whisper lookup. whisperPath keeps a miss for only 15 s, so
 * whether a test's studio looks again depended on the clock and on the
 * tests before it, and the gold traces gained or lost a findWhisper call.
 * A find is kept for the whole process. */
whisperPath({ probe: () => "/test/whisper-cli" });

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
/** A license client that allows every export and never calls out. */
const allowAll = {
  status: () => ({ state: "subscribed" }),
  refresh: async () => ({ state: "subscribed" }),
  beforeExport: async () => ({ allowed: true }),
  close: () => {},
};

async function startStudio({
  lock = null,
  features,
  srcDir = "/src",
  ids = ["nova"],
  before,
  reveal = () => {},
  openUrl = () => {},
  copyText = async () => true,
  sendToPhone = null,
  renderer,
  settings = memorySettings(),
  licensing = () => allowAll,
  buildDelayMs,
  /* The aws command's configuration: a default profile with a region, so
   * a voiced showcase's build gets as far as calling aws. */
  aws = { profiles: () => ["default"], regionOf: () => "us-east-1" },
} = {}) {
  const library = libraryWith(...ids);
  const exportDir = tempDir("studio-exports-");
  before?.(library);
  const studio = createStudio({
    showcasesDir: library,
    lock,
    version: "test",
    srcDir,
    settings,
    licensing,
    renderer,
    exportDir,
    reveal,
    openUrl,
    copyText,
    sendToPhone,
    aws,
    ...(buildDelayMs != null ? { buildDelayMs } : {}),
    /* No file watcher unless a test asks for one: its 250 ms reload timer
     * would race each test's end, and the gold traces would record it only
     * sometimes (issue #12). */
    features: { watch: false, ...features },
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
  return { studio, url, library, exportDir, saved: () => settings.load(), post, info };
}

/** The studio's settings.json, in memory. Pass one to two studios to
 *  have them share it, as studios on one machine do. */
function memorySettings(initial = {}) {
  let saved = initial;
  return { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) };
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
    /* The field reference beside the guide, as JSON a session can read. */
    const schema = JSON.parse(
      readFileSync(path.join(library, ".studio", "showcase.schema.json"), "utf8"),
    );
    expect(schema.title).toBe("showcase.yaml");
    expect(Object.keys(schema.properties.scenes.items.properties)).toContain("take");
    const themeSchema = JSON.parse(
      readFileSync(path.join(library, ".studio", "theme.schema.json"), "utf8"),
    );
    expect(themeSchema.title).toBe("theme.yaml");
    expect(Object.keys(themeSchema.properties.colors.properties)).toContain("caption-text");
    const mcpConfig = JSON.parse(readFileSync(path.join(library, ".studio", "mcp.json"), "utf8"));
    expect(mcpConfig.mcpServers["showcase-studio"].url).toBe(`${url}/mcp`);
  });

  it("marks the library with a commented showcase_settings.yaml", async () => {
    const { library } = await startStudio();
    const settings = readFileSync(path.join(library, "showcase_settings.yaml"), "utf8");
    expect(settings).toMatch(/marks this folder as a library/);
    expect(settings.split("\n").every((line) => line === "" || line.startsWith("#"))).toBe(true);
    expect(readFileSync(path.join(library, "README.md"), "utf8")).toContain(
      "showcase_settings.yaml",
    );
  });

  it("renames an older library's root showcase.yaml and fixes its README", async () => {
    const { library } = await startStudio({
      before: (dir) => {
        writeFileSync(path.join(dir, "showcase.yaml"), "show_in_recent: false\n");
        writeFileSync(
          path.join(dir, "README.md"),
          "# Showcases\n\nA showcase.yaml at this top level (next to the showcase folders) holds\n" +
            "library settings — currently just one:\n\nMy own notes.\n",
        );
      },
    });
    expect(existsSync(path.join(library, "showcase.yaml"))).toBe(false);
    expect(readFileSync(path.join(library, "showcase_settings.yaml"), "utf8")).toBe(
      "show_in_recent: false\n",
    );
    const readme = readFileSync(path.join(library, "README.md"), "utf8");
    expect(readme).toContain("showcase_settings.yaml at this top level");
    expect(readme).not.toContain("A showcase.yaml at this top level");
    expect(readme).toContain("My own notes.");
  });

  it("moves an older showcase's flat voice settings into their Polly block", async () => {
    const flat = SHOWCASE_YAML.replace(
      "  title: Nova\n",
      "  title: Nova\n  voiceover:\n    voice: Joanna # warm\n    track: vo\n",
    );
    const { library } = await startStudio({
      before: (dir) => writeFileSync(path.join(dir, "nova", "showcase.yaml"), flat),
    });
    expect(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8")).toBe(
      flat.replace("    voice: Joanna # warm\n", "    polly:\n      voice: Joanna # warm\n"),
    );
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

  it("refuses to switch to a showcase's folder, or start in one", async () => {
    const { post, info, library } = await startStudio();
    const showcase = path.join(library, "nova");
    expect(await post("library", { dir: showcase })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/is a showcase/),
    });
    expect((await info()).library).toBe(library);
    expect(existsSync(path.join(showcase, "showcase_settings.yaml"))).toBe(false);
    expect(() => createStudio({ showcasesDir: showcase, version: "test" })).toThrow(
      /is a showcase/,
    );
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

  it("moves the cover's picture along when its file is renamed", async () => {
    const { library, post } = await startStudio();
    const files = [{ name: "frame.jpg", data: Buffer.from("jpg").toString("base64") }];
    await post("asset-add", { showcaseId: "nova", files });
    const cover = path.join(library, "nova", "cover.yaml");
    writeFileSync(
      cover,
      "picture: frame # the hero\nheadline: frame\ntiktok:\n  picture: frame.jpg\n",
    );
    expect(
      await post("asset-rename", { showcaseId: "nova", from: "frame.jpg", to: "hero" }),
    ).toMatchObject({ ok: true, name: "hero.jpg", updatedReferences: 2 });
    expect(readFileSync(cover, "utf8")).toBe(
      "picture: hero # the hero\nheadline: frame\ntiktok:\n  picture: hero.jpg\n",
    );
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

  describe("changesByShowcase", () => {
    it("groups a burst of changed files by showcase folder, as paths inside it", () => {
      expect(
        changesByShowcase("/lib", [
          "/lib/nova/assets/voiceover.m4a",
          "/lib/nova/showcase.yaml",
          "/lib/orion/theme.yaml",
        ]),
      ).toEqual(
        new Map([
          ["nova", ["assets/voiceover.m4a", "showcase.yaml"]],
          ["orion", ["theme.yaml"]],
        ]),
      );
    });

    it("counts a showcase's own folder entry as that showcase's change", () => {
      /* Windows reports the folder beside the file written in it. */
      const lib = libraryWith("nova");
      expect(changesByShowcase(lib, [path.join(lib, "nova")])).toEqual(new Map([["nova", []]]));
      expect(
        changesByShowcase(lib, [path.join(lib, "nova"), path.join(lib, "nova", "showcase.yaml")]),
      ).toEqual(new Map([["nova", ["showcase.yaml"]]]));
      /* A folder that isn't there any more is the library changing. */
      expect(changesByShowcase(lib, [path.join(lib, "gone")])).toBeNull();
    });

    it("asks for a reload when the library itself changed", () => {
      /* A showcase folder that went. */
      expect(changesByShowcase("/lib", ["/lib/nova"])).toBeNull();
      /* A file at the library's root. */
      expect(changesByShowcase("/lib", ["/lib/showcase_settings.yaml"])).toBeNull();
      /* A change the watcher couldn't name, among others it could. */
      expect(changesByShowcase("/lib", ["/lib/nova/showcase.yaml", null])).toBeNull();
      expect(changesByShowcase("/lib", ["/elsewhere/x.yaml"])).toBeNull();
    });
  });

  it("sends info when a page connects, names the showcase when its files change outside the studio, and reload when the library does", async () => {
    const { url, library } = await startStudio({ features: { watch: true } });
    const controller = new AbortController();
    cleanups.push(() => controller.abort());
    const response = await fetch(`${url}/studio/api/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    let ended = false;
    /* One reader, running on its own: a read that is abandoned when a
     * wait gives up would swallow the chunk it was holding. */
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
        }
      } catch {
        /* the stream was aborted in cleanup */
      }
      ended = true;
    })();
    const waitFor = async (text, ms) => {
      const deadline = Date.now() + ms;
      while (!received.includes(text)) {
        if (ended) throw new Error(`the event stream ended before "${text}"`);
        if (Date.now() >= deadline) return false;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return true;
    };
    expect(await waitFor("event: info", 5_000)).toBe(true);

    /* A recursive watch takes a moment to start listening, and a change
     * made inside that moment is never seen — on macOS with the whole
     * suite running, that moment can outlast the round trip above. It
     * costs a user nothing (a file changed in the studio's first
     * milliseconds), but a single write here is a race, so keep
     * changing the file until the event comes back. */
    let changed = false;
    for (let i = 0; !changed && i < 20; i++) {
      writeFileSync(path.join(library, "nova", "showcase.yaml"), `${SHOWCASE_YAML}\n# ${i}\n`);
      changed = await waitFor("event: showcase-changed", 500);
    }
    expect(changed).toBe(true);
    /* The page re-reads that one showcase in place: no reload. */
    const event = /event: showcase-changed\ndata: (.*)\n/.exec(received);
    expect(JSON.parse(event[1])).toEqual({ showcaseId: "nova", files: ["showcase.yaml"] });
    expect(received).not.toContain("event: reload");

    /* A file at the library's root is the library changing: reload. */
    let reloaded = false;
    for (let i = 0; !reloaded && i < 20; i++) {
      writeFileSync(path.join(library, "notes.txt"), `note ${i}\n`);
      reloaded = await waitFor("event: reload", 500);
    }
    expect(reloaded).toBe(true);
  }, 20_000);

  it("answers MCP over HTTP: the tool list and studio_info", async () => {
    const { url, library } = await startStudio();
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
      guide: path.join(library, ".studio", "GUIDE.md"),
      schema: path.join(library, ".studio", "showcase.schema.json"),
      themeSchema: path.join(library, ".studio", "theme.schema.json"),
    });
  });

  it("runs MCP tools in-process through callTool", async () => {
    const { studio, url } = await startStudio();
    const result = await studio.callTool({ name: "studio_info", arguments: {} });
    expect(JSON.parse(result.content[0].text)).toMatchObject({ url, showcases: ["nova"] });
    const script = await studio.callTool({ name: "script", arguments: { showcaseId: "nova" } });
    expect(script.content[0].text).toContain("NOVA");
  });

  it("check_titles returns the titles alone, and a key back to the scenes", async () => {
    const { studio, library } = await startStudio();
    const doc = parse(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8"));
    const titled = doc.scenes.filter((scene) => scene.title);
    const result = await studio.callTool({
      name: "check_titles",
      arguments: { showcaseId: "nova" },
    });
    const { brief, slides, next } = JSON.parse(result.content[0].text);
    expect(slides.map((s) => s.sceneId)).toEqual(titled.map((scene) => scene.id));
    expect(brief).toContain(`1. ${String(titled[0].title).replace(/\s+/g, " ").trim()}`);
    for (const scene of doc.scenes) {
      for (const caption of scene.captions ?? []) {
        if (caption.text !== scene.title) expect(brief).not.toContain(caption.text);
      }
      if (scene.note) expect(brief).not.toContain(scene.note);
    }
    expect(next).toContain("subagent");
  });

  it("check_script returns the narration alone, numbered, and a key back to the scenes", async () => {
    const { studio, library } = await startStudio();
    const doc = parse(readFileSync(path.join(library, "nova", "showcase.yaml"), "utf8"));
    const captions = doc.scenes.flatMap((scene) =>
      (scene.captions ?? []).map((c) => ({ sceneId: scene.id, text: c.text })),
    );
    const { brief, lines, next } = JSON.parse(
      (await studio.callTool({ name: "check_script", arguments: { showcaseId: "nova" } }))
        .content[0].text,
    );
    expect(lines.map((l) => l.sceneId)).toEqual(captions.map((c) => c.sceneId));
    expect(brief).toContain("Read it aloud");
    expect(brief).toContain(`1. ${String(captions[0].text).replace(/\s+/g, " ").trim()}`);
    for (const scene of doc.scenes) {
      if (scene.note) expect(brief).not.toContain(scene.note);
    }
    expect(next).toMatch(/subagent|recording/);
  });

  it("check_titles asks for the story on a showcase made from the worked-example template", async () => {
    const { studio } = await startStudio();
    await studio.callTool({
      name: "create_showcase",
      arguments: { name: "Busy Device", template: "worked-example" },
    });
    const story = JSON.parse(
      (await studio.callTool({ name: "check_titles", arguments: { showcaseId: "busy-device" } }))
        .content[0].text,
    );
    expect(story.check).toBe("story");
    expect(story.brief).toContain("retell what happens");
    expect(story.next).toContain("meta.notes");
    const screen = JSON.parse(
      (await studio.callTool({ name: "check_titles", arguments: { showcaseId: "nova" } }))
        .content[0].text,
    );
    expect(screen.check).toBe("screen");
    expect(screen.brief).toContain("what you expect to see on the screen");
  });

  it("validate adds the graphics waiting for a missing caption and the library's bad say entries", async () => {
    /* A page that loads the library and reports nova as built. */
    const renderer = {
      openPage: async () => ({
        goto: async () => {},
        evaluate: async () => ({
          loaded: [{ id: "nova", title: "Nova", slides: 1, runtimeSeconds: 4 }],
          errors: [],
          warnings: [],
        }),
        capture: async () => Buffer.from(""),
        close: async () => {},
      }),
    };
    const { studio } = await startStudio({
      renderer,
      before: (library) => {
        mkdirSync(path.join(library, "nova", "graphics"), { recursive: true });
        writeFileSync(
          path.join(library, "nova", "graphics", "proof.tsx"),
          "export default () => <style>{`.a { animation-delay: var(--caption-reveal-start) }`}</style>;",
        );
        writeFileSync(
          path.join(library, "nova", "showcase.yaml"),
          SHOWCASE_YAML.replace(
            "kind: image\n      asset: shot",
            "kind: graphic\n      graphic: proof",
          ),
        );
        writeFileSync(path.join(library, "showcase_settings.yaml"), "say:\n  AppMap: 3\n");
      },
    });
    const report = JSON.parse(
      (await studio.callTool({ name: "validate", arguments: {} })).content[0].text,
    );
    expect(report.loaded.map((s) => s.id)).toEqual(["nova"]);
    expect(report.warnings).toEqual([
      {
        showcaseId: "",
        sceneId: "",
        message: expect.stringContaining("say.AppMap must be text"),
      },
      {
        showcaseId: "nova",
        sceneId: "intro",
        message: expect.stringContaining("no caption in this scene has id: reveal"),
      },
    ]);
  });

  it("create_showcase scaffolds a showcase through the studio's own + card path", async () => {
    const { studio, library } = await startStudio();
    const made = await studio.callTool({
      name: "create_showcase",
      arguments: { name: "Play Together!" },
    });
    expect(JSON.parse(made.content[0].text)).toEqual({
      id: "play-together",
      path: path.join(library, "play-together"),
    });
    expect(existsSync(path.join(library, "play-together", "assets"))).toBe(true);
    expect(readFileSync(path.join(library, "play-together", "showcase.yaml"), "utf8")).toContain(
      "title: Play Together!",
    );
    const log = readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8");
    expect(log).toContain('"tool":"create_showcase"');
    await expect(
      studio.callTool({ name: "create_showcase", arguments: { name: "Play Together" } }),
    ).rejects.toThrow('A showcase named "play-together" already exists');
    await expect(studio.callTool({ name: "create_showcase", arguments: {} })).rejects.toThrow(
      "Give the showcase a name",
    );
  });

  it("create_showcase starts a showcase from a video template, and list_templates lists them", async () => {
    const { studio, library } = await startStudio();
    const list = JSON.parse(
      (await studio.callTool({ name: "list_templates", arguments: {} })).content[0].text,
    );
    expect(list.templates.map((t) => t.id)).toContain("product-launch");
    const made = JSON.parse(
      (
        await studio.callTool({
          name: "create_showcase",
          arguments: { name: "Tally", template: "product-launch", view: "embed" },
        })
      ).content[0].text,
    );
    expect(made.template).toMatchObject({ id: "product-launch", name: "Product launch" });
    expect(made.template.guidance).toContain("proof-1");
    const yaml = readFileSync(path.join(library, "tally", "showcase.yaml"), "utf8");
    expect(yaml).toContain("template: product-launch");
    expect(yaml).toContain("targetMs: 60000");
    expect(yaml).toContain("view: embed");
    expect(list.views.ask).toContain("view");
    await expect(
      studio.callTool({ name: "create_showcase", arguments: { name: "Wide", view: "cinema" } }),
    ).rejects.toThrow("view must be one of");
    const full = JSON.parse(
      (await studio.callTool({ name: "list_templates", arguments: { id: "product-launch" } }))
        .content[0].text,
    );
    expect(full.guidance).toBe(made.template.guidance);
    await expect(
      studio.callTool({ name: "create_showcase", arguments: { name: "Nope", template: "vlog" } }),
    ).rejects.toThrow('No template named "vlog"');
    const other = JSON.parse(
      (
        await studio.callTool({
          name: "create_showcase",
          arguments: { name: "Odd", template: "other", purpose: "A thank-you" },
        })
      ).content[0].text,
    );
    expect(other.template).toBeUndefined();
    expect(readFileSync(path.join(library, "odd", "showcase.yaml"), "utf8")).toContain(
      "What this video is for: A thank-you",
    );
  });

  it("screenshot_frame returns each frame as an image, with what the page showed", async () => {
    /* A renderer that draws a PNG header of whatever size the page is
     * opened at, and answers the record page's own questions. */
    const png = (width, height) => {
      const header = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
      header.write("IHDR", 12, "latin1");
      header.writeUInt32BE(width, 16);
      header.writeUInt32BE(height, 20);
      return header;
    };
    const opened = [];
    const renderer = {
      openPage: async ({ width, height }) => ({
        goto: async (url) => opened.push(url),
        evaluate: async (script) =>
          script.includes("__record?.at")
            ? {
                scene: { id: "intro", index: 0, count: 1, elapsedMs: 500, durationMs: 3500 },
                caption: { index: 0, count: 1, text: "Hi there." },
              }
            : null,
        capture: async () => png(width, height),
        close: async () => {},
      }),
    };
    const { studio, url } = await startStudio({ renderer });
    const result = await studio.callTool({
      name: "screenshot_frame",
      arguments: { showcaseId: "nova", atMs: [500, 2000], safeArea: true },
    });
    expect(result.content.map((part) => part.type)).toEqual(["image", "text", "image", "text"]);
    expect(result.content[0]).toMatchObject({
      mimeType: "image/png",
      data: png(540, 960).toString("base64"),
    });
    expect(result.content[1].text).toBe(
      'Frame at 500 ms (0:00.5) — scene "intro" (1 of 1, 500 ms in), caption 1 of 1 ("Hi there."); ' +
        "TikTok view, 540×960 (half size), animations finished, safe area shaded.",
    );
    expect(result.content[3].text).toMatch(/^Frame at 2000 ms \(0:02\.0\)/);
    expect(opened).toEqual([`${url}/showcase/nova/record?controlled=1&safeArea=1`]);

    /* The player's Frame button gets the same frame, full size, as a file. */
    const saved = await fetch(`${url}/studio/api/frame?showcase=nova&at=500&view=tiktok`);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-type")).toBe("image/png");
    expect(saved.headers.get("content-disposition")).toBe(
      'attachment; filename="nova-t000500.png"',
    );
    expect(Buffer.from(await saved.arrayBuffer())).toEqual(png(1080, 1920));
    const late = await fetch(`${url}/studio/api/frame?showcase=nova&at=9000`);
    expect(late.status).toBe(500);
    expect(await late.json()).toMatchObject({
      ok: false,
      error: expect.stringContaining("past the end"),
    });
  });

  /* An image the user drops into the Claude chat, or a screenshot Claude
   * captured, is a file somewhere else on disk. Without this tool the
   * user had to find that file and drag it onto the Assets page. */
  it("add_asset copies files in, names the key, and logs the write", async () => {
    const { studio, library } = await startStudio();
    const dropped = path.join(tempDir("chat-drop-"), "image.png");
    writeFileSync(dropped, "what the user dropped");

    const result = await studio.callTool({
      name: "add_asset",
      arguments: { showcaseId: "nova", files: [{ path: dropped, name: "empty-state.png" }] },
    });
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      showcaseId: "nova",
      assets: [{ name: "empty-state.png", key: "empty-state" }],
    });
    const landed = path.join(library, "nova", "assets", "empty-state.png");
    expect(readFileSync(landed, "utf8")).toBe("what the user dropped");

    /* Logged like every other write the studio makes for someone, so
     * the history commits it and the page reloads. */
    const log = readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(log.at(-1)).toMatchObject({
      source: "mcp",
      showcaseId: "nova",
      kind: "asset.add",
      names: ["empty-state.png"],
    });
  });

  it("add_asset says what is wrong instead of writing something unusable", async () => {
    const { studio } = await startStudio();
    const notes = path.join(tempDir("chat-drop-"), "notes.txt");
    writeFileSync(notes, "not media");
    await expect(
      studio.callTool({
        name: "add_asset",
        arguments: { showcaseId: "nova", files: [{ path: notes }] },
      }),
    ).rejects.toThrow(/notes\.txt/);
    await expect(
      studio.callTool({
        name: "add_asset",
        arguments: { showcaseId: "nova", files: [{ path: "/nope/missing.png" }] },
      }),
    ).rejects.toThrow(/\/nope\/missing\.png/);
  });

  /* The real ffmpeg, on a generated source: the tool is how every clip
   * reaches assets/, so the bundled binary has to work through it. */
  it("ffmpeg encodes into assets/ through a temporary file and logs the write", async () => {
    const { studio, library } = await startStudio();
    const landed = path.join(library, "nova", "assets", "clip-hook.mp4");
    const encode = () =>
      studio
        .callTool({
          name: "ffmpeg",
          arguments: {
            showcaseId: "nova",
            output: "clip-hook.mp4",
            args: ["-f", "lavfi", "-i", "color=c=black:s=16x16:r=10:d=0.5", "-pix_fmt", "yuv420p"],
          },
        })
        .then((r) => JSON.parse(r.content[0].text));

    expect(await encode()).toMatchObject({
      showcaseId: "nova",
      asset: { name: "clip-hook.mp4", key: "clip-hook" },
      replaced: false,
      durationMs: 500,
    });
    expect(readFileSync(landed).length).toBeGreaterThan(0);
    expect(await encode()).toMatchObject({ replaced: true });

    const log = readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(log.at(-1)).toMatchObject({
      source: "mcp",
      showcaseId: "nova",
      kind: "asset.encode",
      name: "clip-hook.mp4",
      replaced: true,
    });

    await expect(
      studio.callTool({
        name: "ffmpeg",
        arguments: { showcaseId: "nova", output: "clip-hook.mp4", args: ["-i", "assets/none.mov"] },
      }),
    ).rejects.toThrow(/none\.mov/);
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

  it("puts exports where the library's export_dir says", async () => {
    const { post, library } = await startStudio({
      before: (dir) =>
        writeFileSync(path.join(dir, "showcase_settings.yaml"), "export_dir: renders\n"),
    });
    let { job } = await post("export", { kind: "script", showcaseId: "nova" });
    for (let i = 0; job.status === "running" && i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ({ job } = await post("export-status", { jobId: job.jobId }));
    }
    expect(job.status).toBe("done");
    expect(path.dirname(job.out)).toBe(path.join(library, "renders", "nova"));
    expect(await post("export-reveal", { showcaseId: "nova" })).toEqual({
      ok: true,
      path: path.join(library, "renders", "nova"),
    });
  });

  it("reports the current export and reveals exports in the file manager", async () => {
    const revealed = [];
    const { post } = await startStudio({ reveal: (target) => revealed.push(target) });
    expect(await post("export-current")).toEqual({ ok: true, job: null });
    expect(await post("export-reveal", { showcaseId: "nova" })).toMatchObject({
      ok: false,
      error: "nova has no exports yet",
    });

    let { job } = await post("export", { kind: "script", showcaseId: "nova" });
    for (let i = 0; job.status === "running" && i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ({ job } = await post("export-current"));
    }
    expect(job).toMatchObject({ kind: "script", showcaseId: "nova", status: "done" });

    // A finished job is selected in its folder; otherwise the folder opens.
    expect(await post("export-reveal", { jobId: job.jobId })).toEqual({ ok: true, path: job.out });
    expect(await post("export-reveal", { showcaseId: "nova" })).toEqual({
      ok: true,
      path: path.dirname(job.out),
    });
    // The path is the studio's own: a request can't point it elsewhere.
    for (const showcaseId of ["../nova", "..", ".studio", ""]) {
      expect(await post("export-reveal", { showcaseId })).toMatchObject({ ok: false });
    }
    expect(revealed).toEqual([job.out, path.dirname(job.out)]);
  });

  it("turns the embedded terminals off when asked", async () => {
    const { post, info } = await startStudio({ features: { terminal: false } });
    expect((await info()).features).toEqual({ terminal: false, airDrop: false });
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

  /* Media builds have their own job lane, so a build and an export never
   * wait on each other. The build itself is server/build-media.test.mjs;
   * this is the wiring — the page action, the MCP tools, and the "build"
   * event they both report through. */
  it("builds media in its own job lane, and says so to pages and to Claude", async () => {
    const events = [];
    const { studio, post, url } = await startStudio();
    const stream = await fetch(`${url}/studio/api/events`);
    const reader = stream.body.getReader();
    const reading = (async () => {
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const text = decoder.decode(value);
        if (text.includes("event: build")) events.push(text);
        if (events.length >= 1) return;
      }
    })();

    /* "nova" has no meta.source, so the build fails — which is the point:
     * the failure has to arrive as a build job, not a dropped promise. */
    const started = await post("build", { showcaseId: "nova" });
    expect(started.ok).toBe(true);
    expect(started.job).toMatchObject({ jobId: "build-1", kind: "build", showcaseId: "nova" });

    const settled = async () => {
      for (let i = 0; i < 50; i += 1) {
        const { job } = await post("build-current");
        if (job && job.status !== "running") return job;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("the build never finished");
    };
    const job = await settled();
    expect(job.status).toBe("failed");
    expect(job.error).toContain("not built from a recording");

    await reading;
    expect(events.length).toBeGreaterThan(0);
    await reader.cancel();

    /* The same jobs, through the MCP tools Claude calls. */
    const call = (name, args) =>
      studio.callTool({ name, arguments: args }).then((r) => JSON.parse(r.content[0].text));
    const mcpJob = await call("build_media", { showcaseId: "nova" });
    expect(mcpJob).toMatchObject({ jobId: "build-2", kind: "build" });
    expect(await call("build_status", { jobId: mcpJob.jobId })).toMatchObject({
      jobId: mcpJob.jobId,
    });
    expect(await call("build_cancel", { jobId: mcpJob.jobId })).toMatchObject({
      jobId: mcpJob.jobId,
    });
    await expect(call("build_status", { jobId: "nope" })).rejects.toThrow("No build job named");

    /* A synthesized voiceover runs in the same lane, asked for by name —
     * and "nova" has no meta.voiceover, so it fails, as a job. */
    const voiced = await post("voiceover", { showcaseId: "nova" });
    expect(voiced.job).toMatchObject({ kind: "voiceover", showcaseId: "nova" });
    const voicedJob = await settled();
    expect(voicedJob.status).toBe("failed");
    expect(voicedJob.error).toContain("has no meta.voiceover");
    const mcpVoiced = await call("build_voiceover", { showcaseId: "nova" });
    expect(mcpVoiced).toMatchObject({ kind: "voiceover", showcaseId: "nova" });
    await settled();
  }, 30_000);
});

/* The build runs on its own (server/auto-build.mjs): an edit to a built
 * showcase starts a quiet period, then a build as "studio". "talk" is
 * voiced by Polly, and no aws is signed in here, so the build fails —
 * which is the point: the failure arrives as the studio's own job, and
 * an export of it fails the same way instead of rendering stale media. */
const VOICED_YAML = `meta:
  title: Talk
  voiceover:
    polly:
      voice: Matthew
scenes:
  - id: intro
    theme: statement
    title: Hello
    captions:
      - text: Hi there.
`;

describe("the automatic build", () => {
  /* The build ends when the aws command has failed, which takes a few
   * seconds on Windows (it is installed there, signed in nowhere), so the
   * wait is most of the test's own 30 s. */
  const settledBuild = async (post) => {
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
      const { job } = await post("build-current");
      if (job && job.status !== "running") return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("no build ended");
  };

  it("builds a voiced showcase a quiet period after an edit, as the studio, and says so", async () => {
    const { studio, post, url } = await startStudio({
      ids: ["nova", "talk"],
      before: (lib) => writeFileSync(path.join(lib, "talk", "showcase.yaml"), VOICED_YAML),
      buildDelayMs: 30,
    });
    const call = (name, args) =>
      studio.callTool({ name, arguments: args }).then((r) => JSON.parse(r.content[0].text));
    /* studio_info knows which showcases derive media, and that this one
     * has everything to do. */
    const info = await call("studio_info", {});
    expect(info.autoBuild).toBe(true);
    expect(info.media).toEqual([
      {
        showcaseId: "talk",
        kind: "voiceover",
        upToDate: false,
        stale: [
          "intro caption 1 (to voice)",
          "voiceover.m4a",
          "voiceover.words.json",
          "meta.soundtrack",
        ],
      },
    ]);

    const hash = contentHash(VOICED_YAML);
    const edited = await post("scene-edit", {
      showcaseId: "talk",
      baseHash: hash,
      field: "caption.set",
      sceneId: "intro",
      captionIndex: 0,
      name: "text",
      value: "Hello there.",
    });
    expect(edited.ok).toBe(true);
    /* The quiet period is a pending record (beside the commit's); then
     * the build, by the studio. */
    const listed = await (await fetch(`${url}/studio/api/actions`)).json();
    expect(listed.actions ?? listed).toContainEqual(
      expect.objectContaining({
        kind: "build",
        showcaseId: "talk",
        by: "studio",
        state: "pending",
        label: "Build media",
        offers: ["skip"],
      }),
    );
    const job = await settledBuild(post);
    expect(job).toMatchObject({ kind: "voiceover", showcaseId: "talk", by: "studio" });
    expect(job.why).toContain("talk changed — ");
    expect(job.status).toBe("failed");

    /* An edit to a showcase that derives nothing starts nothing. */
    const plain = await post("scene-edit", {
      showcaseId: "nova",
      baseHash: contentHash(SHOWCASE_YAML),
      field: "scene.set",
      sceneId: "intro",
      name: "title",
      value: "Hi",
    });
    expect(plain.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await post("build-current")).job.jobId).toBe(job.jobId);
  }, 30_000);

  it("answers a voice build that can't start with the problem, and starts no job", async () => {
    /* A machine with named profiles only, and nothing naming one: the
     * user is to be asked, and the Actions list already says so once. */
    const { studio, post } = await startStudio({
      ids: ["talk"],
      before: (lib) => writeFileSync(path.join(lib, "talk", "showcase.yaml"), VOICED_YAML),
      aws: { profiles: () => ["work"], regionOf: () => undefined },
    });
    const refused = studio.callTool({ name: "build_voiceover", arguments: { showcaseId: "talk" } });
    await expect(refused).rejects.toThrow(/^No AWS profile for Polly.*profiles: work\./);
    expect((await post("build-current")).job).toBeNull();
    const info = await studio
      .callTool({ name: "studio_info", arguments: {} })
      .then((r) => JSON.parse(r.content[0].text));
    expect(info.media).toEqual([
      {
        showcaseId: "talk",
        kind: "voiceover",
        upToDate: false,
        problem: expect.stringContaining("Ask the user which one"),
      },
    ]);
  });

  it("has a switch, studio-wide, logged like the commit one", async () => {
    const { post, info, library } = await startStudio({
      ids: ["talk"],
      before: (lib) => writeFileSync(path.join(lib, "talk", "showcase.yaml"), VOICED_YAML),
      buildDelayMs: 30,
    });
    expect((await info()).autoBuild).toBe(true);
    expect(await post("media-auto-build", { on: false })).toEqual({ ok: true, autoBuild: false });
    expect((await info()).autoBuild).toBe(false);
    expect(await post("media-auto-build", { on: "yes" })).toMatchObject({ ok: false });
    /* Off: an edit starts no quiet period and no build. */
    await post("scene-edit", {
      showcaseId: "talk",
      baseHash: contentHash(VOICED_YAML),
      field: "caption.set",
      sceneId: "intro",
      captionIndex: 0,
      name: "text",
      value: "Hello there.",
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect((await post("build-current")).job).toBeNull();
    const settingLines = changesIn(library).filter((line) => line.kind === "setting");
    expect(settingLines).toEqual([
      expect.objectContaining({ source: "ui", name: "autoBuild", value: false }),
    ]);
    /* The status on its own, for the page. */
    expect(await post("media-status", { showcaseId: "talk" })).toMatchObject({
      ok: true,
      status: { built: true, kind: "voiceover", upToDate: false },
    });
  });

  it("builds before an export, and a build that fails fails the export", async () => {
    const { post, library } = await startStudio({
      ids: ["talk"],
      before: (lib) => writeFileSync(path.join(lib, "talk", "showcase.yaml"), VOICED_YAML),
      renderer: { pageRenderer: () => ({}) },
    });
    const started = await post("export", { kind: "script", showcaseId: "talk" });
    expect(started.ok).toBe(true);
    let job;
    for (let i = 0; i < 200; i += 1) {
      ({ job } = await post("export-status", { jobId: started.job.jobId }));
      if (job.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(job.status).toBe("failed");
    expect(job.error).toContain("The media build failed");
    /* The build it ran is in the lane, marked as the export's starter. */
    const { job: build } = await post("build-current");
    expect(build).toMatchObject({ kind: "voiceover", showcaseId: "talk", by: "user" });
    expect(build.why).toContain("before its");
    void library;
  }, 30_000);
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

  it("edit_theme writes theme.yaml, logs it, and refuses a stale ifVersion with the style-panel edits since", async () => {
    const { studio, library } = await startStudio();
    const file = path.join(library, "nova", "theme.yaml");

    const read = await studio.callTool({
      name: "read_showcase",
      arguments: { showcaseId: "nova" },
    });
    expect(JSON.parse(read.content[0].text).themeVersion).toBeNull();
    expect(read.content).toHaveLength(2);

    const edited = await studio.callTool({
      name: "edit_theme",
      arguments: {
        showcaseId: "nova",
        edits: [
          { key: "colors.primary", value: "#4ade80" },
          { key: "fonts.display", value: "Inter" },
        ],
      },
    });
    const { applied, version } = JSON.parse(edited.content[0].text);
    expect(applied).toBe(2);
    expect(version).toBe(contentHash(readFileSync(file)));
    expect(readFileSync(file, "utf8")).toContain('primary: "#4ade80"');
    expect(changesIn(library).at(-1)).toMatchObject({
      source: "mcp",
      tool: "edit_theme",
      kind: "edit",
      file: "theme.yaml",
      previousVersion: null,
      version,
      edits: [
        { field: "theme.set", key: "colors.primary", value: "#4ade80" },
        { field: "theme.set", key: "fonts.display", value: "Inter" },
      ],
    });
    const reread = await studio.callTool({
      name: "read_showcase",
      arguments: { showcaseId: "nova" },
    });
    expect(JSON.parse(reread.content[0].text).themeVersion).toBe(version);
    expect(reread.content[2].text).toBe(`# theme.yaml\n${readFileSync(file, "utf8")}`);

    /* The user picks a caption color in the style panel. */
    await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/scene-edit",
      body: {
        showcaseId: "nova",
        field: "theme",
        group: "colors",
        name: "caption-text",
        value: "#ffd166",
        baseHash: version,
      },
    });
    const afterUi = readFileSync(file, "utf8");

    const refused = await studio
      .callTool({
        name: "edit_theme",
        arguments: {
          showcaseId: "nova",
          ifVersion: version,
          edits: [{ key: "colors.primary", value: "#22d3ee" }],
        },
      })
      .catch((error) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused.message).toContain("theme.yaml changed since version");
    expect(refused.message).toContain("The studio logged these changes since then");
    expect(refused.message).toContain('"caption-text"');
    expect(refused.message).toContain(`The current version is ${contentHash(afterUi)}`);
    expect(readFileSync(file, "utf8")).toBe(afterUi);

    const bad = await studio
      .callTool({
        name: "edit_theme",
        arguments: { showcaseId: "nova", edits: [{ key: "colors.glow", value: "red" }] },
      })
      .catch((error) => error);
    expect(bad.message).toContain('Unknown colors key "glow"');
    expect(readFileSync(file, "utf8")).toBe(afterUi);
  });

  it("edit_cover makes cover.yaml, logs it, and refuses a stale ifVersion with the Cover page's edits since", async () => {
    const { studio, library } = await startStudio();
    const file = path.join(library, "nova", "cover.yaml");

    const read = await studio.callTool({
      name: "read_showcase",
      arguments: { showcaseId: "nova" },
    });
    expect(JSON.parse(read.content[0].text).coverVersion).toBeNull();

    /* Claude makes the cover: no cover yet, so ifVersion is null. */
    const edited = await studio.callTool({
      name: "edit_cover",
      arguments: {
        showcaseId: "nova",
        ifVersion: null,
        edits: [
          { name: "headline", value: "Mirror your iPhone" },
          { destination: "instagram", name: "layout", value: "band" },
        ],
      },
    });
    const { applied, version } = JSON.parse(edited.content[0].text);
    expect(applied).toBe(2);
    expect(version).toBe(contentHash(readFileSync(file)));
    expect(changesIn(library).at(-1)).toMatchObject({
      source: "mcp",
      tool: "edit_cover",
      kind: "edit",
      file: "cover.yaml",
      previousVersion: null,
      version,
      edits: [
        { field: "cover", name: "headline", value: "Mirror your iPhone" },
        { field: "cover", destination: "instagram", name: "layout", value: "band" },
      ],
    });
    const reread = await studio.callTool({
      name: "read_showcase",
      arguments: { showcaseId: "nova" },
    });
    expect(JSON.parse(reread.content[0].text).coverVersion).toBe(version);
    expect(reread.content.at(-1).text).toBe(`# cover.yaml\n${readFileSync(file, "utf8")}`);

    /* The user makes the fade stronger on the Cover page. */
    await handleDirectly(studio, {
      method: "POST",
      url: "/studio/api/scene-edit",
      body: {
        showcaseId: "nova",
        sceneId: "",
        field: "cover",
        name: "fade",
        value: "strong",
        baseHash: version,
      },
    });
    const afterUi = readFileSync(file, "utf8");
    expect(afterUi).toContain("fade: strong");

    const refused = await studio
      .callTool({
        name: "edit_cover",
        arguments: {
          showcaseId: "nova",
          ifVersion: version,
          edits: [{ name: "fade", value: "light" }],
        },
      })
      .catch((error) => error);
    expect(refused).toBeInstanceOf(Error);
    expect(refused.message).toContain("cover.yaml changed since version");
    expect(refused.message).toContain("The studio logged these changes since then");
    expect(refused.message).toContain('"strong"');
    expect(refused.message).toContain(`The current version is ${contentHash(afterUi)}`);
    expect(readFileSync(file, "utf8")).toBe(afterUi);

    const bad = await studio
      .callTool({
        name: "edit_cover",
        arguments: { showcaseId: "nova", edits: [{ name: "layout", value: "poster" }] },
      })
      .catch((error) => error);
    expect(bad.message).toContain("layout must be one of fade, band, split");
    expect(readFileSync(file, "utf8")).toBe(afterUi);
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

describe("sharing the prompter", () => {
  /* The publish endpoint, in a local HTTP server: the real rules
   * (cdk/lambda/publish-core.mjs) over an in-memory bucket. */
  async function publishEndpoint() {
    const objects = new Map();
    const store = {
      head: async (token) => objects.get(token)?.hash ?? null,
      put: async (token, body, hash) => void objects.set(token, { body, hash }),
    };
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const [status, result] = await publish(JSON.parse(body), { store, siteUrl: SITE });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    return { url: `http://127.0.0.1:${server.address().port}`, objects, store };
  }

  const SITE = "https://prompter.test";
  const envUrl = process.env.PROMPTER_PUBLISH_URL;
  beforeEach(() => delete process.env.PROMPTER_PUBLISH_URL);
  afterEach(() => {
    if (envUrl !== undefined) process.env.PROMPTER_PUBLISH_URL = envUrl;
  });

  const folderOf = (library, id) => realpathSync(path.join(library, id));

  it("saves the link under the showcase folder's path and updates it in place", async () => {
    const endpoint = await publishEndpoint();
    const settings = memorySettings({ prompterPublishUrl: endpoint.url });
    const { post, library } = await startStudio({ settings });

    const first = await post("prompter-publish", { showcaseId: "nova" });
    expect(first).toMatchObject({ ok: true, replaced: false });
    const link = settings.load().prompterLinks[folderOf(library, "nova")];
    expect(first.url).toBe(`${SITE}/p/${link.token}`);
    expect(link.editKey).toBeTruthy();

    const again = await post("prompter-publish", { showcaseId: "nova" });
    expect(again).toMatchObject({ ok: true, url: first.url, replaced: false });
    expect(endpoint.objects.size).toBe(1);
  });

  it("gives same-named showcases in two libraries their own links", async () => {
    const endpoint = await publishEndpoint();
    const settings = memorySettings({ prompterPublishUrl: endpoint.url });
    const a = await startStudio({ settings });
    const b = await startStudio({ settings });

    const fromA = await a.post("prompter-publish", { showcaseId: "nova" });
    const fromB = await b.post("prompter-publish", { showcaseId: "nova" });
    expect(fromA.url).not.toBe(fromB.url);
    expect(Object.keys(settings.load().prompterLinks)).toHaveLength(2);
  });

  it("keeps the link of a showcase whose folder moved", async () => {
    const endpoint = await publishEndpoint();
    const [, made] = await publish(
      { script: { version: 1, scenes: [] } },
      { store: endpoint.store, siteUrl: SITE },
    );
    const gone = path.join(tmpdir(), "no-such-library", "nova");
    const settings = memorySettings({
      prompterPublishUrl: endpoint.url,
      prompterLinks: { [gone]: { token: made.token, editKey: made.editKey } },
    });
    const { post, library } = await startStudio({ settings });

    const result = await post("prompter-publish", { showcaseId: "nova" });
    expect(result).toMatchObject({ ok: true, url: made.url, replaced: false });
    expect(Object.keys(settings.load().prompterLinks)).toEqual([folderOf(library, "nova")]);
  });

  it("makes a new link when two moved folders could be the one", async () => {
    const endpoint = await publishEndpoint();
    const link = { token: "t".repeat(22), editKey: "k" };
    const settings = memorySettings({
      prompterPublishUrl: endpoint.url,
      prompterLinks: {
        [path.join(tmpdir(), "gone-1", "nova")]: link,
        [path.join(tmpdir(), "gone-2", "nova")]: link,
      },
    });
    const { post } = await startStudio({ settings });

    const result = await post("prompter-publish", { showcaseId: "nova" });
    expect(result).toMatchObject({ ok: true, replaced: false });
    expect(result.url).not.toContain(link.token);
    expect(Object.keys(settings.load().prompterLinks)).toHaveLength(3);
  });

  it("replaces a link that expired, and says so", async () => {
    const endpoint = await publishEndpoint();
    const settings = memorySettings({ prompterPublishUrl: endpoint.url });
    const { post, library } = await startStudio({ settings });

    const first = await post("prompter-publish", { showcaseId: "nova" });
    endpoint.objects.clear(); // the bucket dropped it after 30 days
    const next = await post("prompter-publish", { showcaseId: "nova" });
    expect(next).toMatchObject({ ok: true, replaced: true });
    expect(next.url).not.toBe(first.url);
    const link = settings.load().prompterLinks[folderOf(library, "nova")];
    expect(next.url).toBe(`${SITE}/p/${link.token}`);
  });

  it("refuses a showcase that isn't there", async () => {
    const { post } = await startStudio();
    expect(await post("prompter-publish", { showcaseId: "nope" })).toMatchObject({ ok: false });
  });
});

describe("sharing", () => {
  /** A finished full-quality export of nova, recorded the way the
   *  studio records one. */
  function recordExport(library, exportDir) {
    const dir = path.join(exportDir, "nova");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "nova.mp4");
    writeFileSync(file, "0123456789");
    const records = createExportRecords({ getLibrary: () => library, appVersion: "test" });
    return records.add({
      showcaseId: "nova",
      kind: "video",
      file,
      fingerprint: records.fingerprint("nova"),
      durationMs: 4000,
    });
  }

  it("reports the share status, and saves the post text through scene-edit", async () => {
    const { post, library, exportDir } = await startStudio();
    const video = recordExport(library, exportDir);
    const { status } = await post("share-status", { showcaseId: "nova" });
    expect(status.exports.video.current).toMatchObject({ id: video.id, current: true });
    expect(status.destinations.map((d) => d.id)).toEqual([
      "tiktok",
      "instagram",
      "youtube",
      "youtube43",
    ]);

    const edited = await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "",
      baseHash: status.version,
      field: "publish.set",
      destination: "tiktok",
      name: "hashtags",
      value: ["techtok"],
    });
    expect(edited).toMatchObject({ ok: true });
    const after = (await post("share-status", { showcaseId: "nova" })).status;
    expect(after.destinations[0].paste).toBe("#techtok");
    /* The post's text doesn't make the video stale. */
    expect(after.exports.video.current).toMatchObject({ id: video.id });
  });

  it("hands off from this computer by opening the upload page", async () => {
    const opened = [];
    const { post, library, exportDir } = await startStudio({ openUrl: (u) => opened.push(u) });
    expect(
      await post("share-handoff", {
        showcaseId: "nova",
        destination: "tiktok",
        method: "computer",
      }),
    ).toEqual({
      ok: false,
      error: 'nova has no current full-quality video — export it first (kind "video")',
    });
    const video = recordExport(library, exportDir);
    const result = await post("share-handoff", {
      showcaseId: "nova",
      destination: "tiktok",
      method: "computer",
    });
    expect(result).toMatchObject({ ok: true, handoff: { exportId: video.id, method: "computer" } });
    expect(opened).toEqual(["https://www.tiktok.com/tiktokstudio/upload"]);

    expect(
      await post("share-post-link", {
        showcaseId: "nova",
        destination: "tiktok",
        url: "https://www.tiktok.com/@nova/video/1",
      }),
    ).toMatchObject({ ok: true, handoff: { id: result.handoff.id } });
    await post("share-open-post", { showcaseId: "nova", handoffId: result.handoff.id });
    expect(opened.at(-1)).toBe("https://www.tiktok.com/@nova/video/1");
  });

  it("sends to the phone only where it can AirDrop", async () => {
    const sent = [];
    const withAirDrop = await startStudio({ sendToPhone: (file) => sent.push(file) });
    const video = recordExport(withAirDrop.library, withAirDrop.exportDir);
    expect((await withAirDrop.info()).features.airDrop).toBe(true);
    await withAirDrop.post("share-handoff", {
      showcaseId: "nova",
      destination: "instagram",
      method: "phone",
    });
    expect(sent).toEqual([video.file]);

    const without = await startStudio();
    recordExport(without.library, without.exportDir);
    expect(
      await without.post("share-handoff", {
        showcaseId: "nova",
        destination: "instagram",
        method: "phone",
      }),
    ).toEqual({ ok: false, error: "Sending to the phone needs AirDrop, which only a Mac has" });
  });

  it("serves a recorded export's video in byte ranges, and reveals it", async () => {
    const revealed = [];
    const { url, library, exportDir, post } = await startStudio({
      reveal: (p) => revealed.push(p),
    });
    const video = recordExport(library, exportDir);
    const src = `${url}/studio/api/export-video?showcase=nova&id=${video.id}`;
    const whole = await fetch(src);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(await whole.text()).toBe("0123456789");
    const part = await fetch(src, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-4/10");
    expect(await part.text()).toBe("234");
    expect((await fetch(`${url}/studio/api/export-video?showcase=nova&id=../x`)).status).toBe(404);

    expect(await post("share-reveal", { showcaseId: "nova", exportId: video.id })).toEqual({
      ok: true,
      path: video.file,
    });
    expect(revealed).toEqual([video.file]);
  });

  it("gives Claude the share tools", async () => {
    const opened = [];
    const copied = [];
    const revealed = [];
    const { studio, library, exportDir } = await startStudio({
      openUrl: (u) => opened.push(u),
      copyText: async (text) => (copied.push(text), true),
      reveal: (p) => revealed.push(p),
    });
    const call = async (name, args) =>
      JSON.parse((await studio.callTool({ name, arguments: args })).content[0].text);

    const notYet = await call("share", { showcaseId: "nova", destination: "youtube" });
    expect(notYet).toMatchObject({ handedOff: false, latestExport: null });
    expect(notYet.next).toContain('export {kind: "video"}');

    const video = recordExport(library, exportDir);
    await call("edit_showcase", {
      showcaseId: "nova",
      edits: [{ field: "publish.set", name: "caption", value: "Play Nova." }],
    });
    const status = await call("share_status", { showcaseId: "nova" });
    expect(status.page).toMatch(/\/showcase\/nova\/share$/);
    const done = await call("share", { showcaseId: "nova", destination: "youtube" });
    expect(done).toMatchObject({ handedOff: true, copied: true, video: video.file });
    expect(done.next).toContain('give it the title "Nova"');
    expect(opened).toEqual(["https://www.youtube.com/upload"]);
    expect(revealed).toEqual([video.file]);
    expect(copied).toEqual(["Play Nova."]);
    expect(done.problems).toEqual([]);

    const linked = await call("share_record", {
      showcaseId: "nova",
      destination: "youtube",
      url: "https://youtube.com/shorts/abc",
    });
    expect(linked).toMatchObject({
      id: done.handoff.id,
      postUrl: "https://youtube.com/shorts/abc",
    });
  });
});

describe("recording exports", () => {
  it("records a full-quality video export, which the Share page then finds current", async () => {
    const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
    // The exporter checks each frame is the size it asked for.
    const { width, height } = VIDEO_FORMATS.video;
    const png = path.join(tempDir("studio-frame-"), "frame.png");
    execFileSync(
      ffmpeg,
      ["-f", "lavfi", "-i", `color=c=red:s=${width}x${height}`, "-frames:v", "1", png],
      { stdio: "ignore" },
    );
    const frame = readFileSync(png);
    const renderer = {
      openPage: async () => ({
        goto: async () => {},
        evaluate: async () => {},
        capture: async () => frame,
        close: async () => {},
      }),
    };
    const { post } = await startStudio({ renderer });
    const { job } = await post("export", { kind: "video", showcaseId: "nova" });
    let status = job;
    for (let i = 0; i < 200 && status.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await post("export-status", { jobId: job.jobId })).job;
    }
    expect(status).toMatchObject({ status: "done" });
    const share = (await post("share-status", { showcaseId: "nova" })).status;
    expect(share.exports.video.current).toMatchObject({
      kind: "video",
      file: status.out,
      current: true,
    });
    /* It was timed, so the next estimate is this studio's own. */
    const { frames, renderMs } = share.exports.video.current;
    expect(frames).toBeGreaterThan(0);
    expect(renderMs).toBeGreaterThan(0);
    expect(share.exports.video.estimateMs).toBe(Math.round(frames * (renderMs / frames)));
  }, 30_000);

  /* A video renders for minutes; the showcase can change meanwhile
   * (issue #29). The export reads from a snapshot taken when it started,
   * served beside the library, and the Share page then says the video is
   * behind the showcase. */
  it("renders from a snapshot of the showcase, untouched by an edit made meanwhile", async () => {
    const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
    const { width, height } = VIDEO_FORMATS["video-draft"];
    const png = path.join(tempDir("studio-frame-"), "frame.png");
    execFileSync(
      ffmpeg,
      ["-f", "lavfi", "-i", `color=c=red:s=${width}x${height}`, "-frames:v", "1", png],
      { stdio: "ignore" },
    );
    const frame = readFileSync(png);
    let post;
    let url;
    const opened = [];
    const seen = {};
    let edited = false;
    const renderer = {
      openPage: async () => ({
        goto: async (pageUrl) => opened.push(pageUrl),
        evaluate: async (script) => {
          if (!script.includes("__record.seek(") || edited) return undefined;
          edited = true;
          /* The first frame is on screen: the user retitles the scene,
           * and the page the export drives would re-read the showcase. */
          const snapshot = new URL(opened[0]).searchParams.get("snapshot");
          const text = async (p) => (await fetch(`${url}${p}`)).text();
          expect(
            (
              await post("scene-edit", {
                showcaseId: "nova",
                baseHash: contentHash(SHOWCASE_YAML),
                field: "scene.set",
                sceneId: "intro",
                name: "title",
                value: "Hello again",
              })
            ).ok,
          ).toBe(true);
          seen.live = await text("/showcase-data/nova/showcase.yaml");
          seen.snapshot = await text(`/showcase-data-snapshot/${snapshot}/nova/showcase.yaml`);
          seen.index = JSON.parse(await text(`/showcase-data-snapshot/${snapshot}/index.json`));
          return undefined;
        },
        capture: async () => frame,
        close: async () => {},
      }),
    };
    ({ post, url } = await startStudio({ renderer }));
    const { job } = await post("export", { kind: "video-draft", showcaseId: "nova" });
    let status = job;
    for (let i = 0; i < 200 && status.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await post("export-status", { jobId: job.jobId })).job;
    }
    expect(status).toMatchObject({ status: "done" });
    expect(edited).toBe(true);
    /* The page was opened on the snapshot, named for this studio and the job. */
    expect(opened).toEqual([
      `${url}/showcase/nova/record?controlled=1&snapshot=${process.pid}-${job.jobId}`,
    ]);
    /* While it rendered: the library had the edit, the snapshot did not. */
    expect(seen.live).toContain("Hello again");
    expect(seen.snapshot).toBe(SHOWCASE_YAML);
    expect(seen.index.showcases.map((s) => s.id)).toEqual(["nova"]);
    /* The snapshot went with the job. */
    const gone = await fetch(
      `${url}/showcase-data-snapshot/${process.pid}-${job.jobId}/nova/showcase.yaml`,
    );
    expect(gone.status).toBe(404);
    /* The video is of the showcase as it was, and the Share page says so. */
    const share = (await post("share-status", { showcaseId: "nova" })).status;
    expect(share.exports["video-draft"]).toMatchObject({
      current: null,
      latest: { file: status.out, current: false },
    });
  }, 30_000);
});

describe("licensing", () => {
  it("fails a full-quality export the license client refuses, with its message", async () => {
    const refuse = {
      ...allowAll,
      status: () => ({ state: "trial", freeLeft: 0 }),
      beforeExport: async (kind) =>
        kind === "video"
          ? { allowed: false, message: "You've used your 2 free full-quality videos." }
          : { allowed: true },
    };
    const { post } = await startStudio({ licensing: () => refuse });
    const { job } = await post("export", { kind: "video", showcaseId: "nova" });
    let status = job;
    for (let i = 0; i < 100 && status.status === "running"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      status = (await post("export-status", { jobId: job.jobId })).job;
    }
    expect(status).toMatchObject({
      status: "failed",
      error: "You've used your 2 free full-quality videos.",
    });
    expect(await post("license-status", {})).toEqual({
      ok: true,
      status: { state: "subscribed" },
    });
  });

  it("gives the page the saved key only when it asks for it", async () => {
    const withKey = { ...allowAll, savedKey: () => "SS-AAAA-BBBB-CCCC-DDDD" };
    const { post } = await startStudio({ licensing: () => withKey });
    expect(await post("license-key-get", {})).toEqual({ ok: true, key: "SS-AAAA-BBBB-CCCC-DDDD" });
  });

  it("hands the license client what it needs to tell pages about changes", async () => {
    let given;
    await startStudio({ licensing: (deps) => ((given = deps), allowAll) });
    expect(Object.keys(given).sort()).toEqual(["onChange", "openUrl", "settings"]);
  });
});

describe("the studio's own code, from source", () => {
  /** A checkout the studio takes for its source: src/components marks it. */
  function checkout() {
    const dir = tempDir("studio-src-");
    mkdirSync(path.join(dir, "src", "components"), { recursive: true });
    mkdirSync(path.join(dir, "server"), { recursive: true });
    writeFileSync(path.join(dir, "server", "edit-yaml.mjs"), "export const a = 1;\n");
    return dir;
  }

  it("is not reported by a studio with no source (the packaged app)", async () => {
    const { info } = await startStudio({ features: { watch: true } });
    expect(await info()).not.toHaveProperty("changedCode");
  });

  it("is reported as changedCode, and sent to pages, once a module changes on disk", async () => {
    const srcDir = checkout();
    const { url, info } = await startStudio({ srcDir, features: { watch: true } });
    expect((await info()).changedCode).toEqual([]);

    const controller = new AbortController();
    cleanups.push(() => controller.abort());
    const response = await fetch(`${url}/studio/api/events`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
        }
      } catch {
        /* the stream was aborted in cleanup */
      }
    })();

    /* Written again every half second until the studio has seen it: on
     * macOS a change made in the first moments after a watcher starts
     * can go unseen (the FSEvents stream is still being set up). */
    const deadline = Date.now() + 5_000;
    let nextWrite = 0;
    while (!received.includes("event: code") && Date.now() < deadline) {
      if (Date.now() >= nextWrite) {
        writeFileSync(path.join(srcDir, "server", "edit-yaml.mjs"), "export const a = 2;\n");
        nextWrite = Date.now() + 500;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(received).toContain('event: code\ndata: {"changed":["server/edit-yaml.mjs"]}');
    expect((await info()).changedCode).toEqual(["server/edit-yaml.mjs"]);
  }, 10_000);
});

describe("the Actions list", () => {
  const settled = async (post) => {
    let { job } = await post("export-current");
    for (let i = 0; job?.status === "running" && i < 100; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      ({ job } = await post("export-current"));
    }
    return job;
  };

  it("records each export with who started it, and runs a record's offers", async () => {
    const revealed = [];
    const { studio, url, library, post } = await startStudio({
      reveal: (target) => revealed.push(target),
    });
    const actionsOf = async () => (await (await fetch(`${url}/studio/api/actions`)).json()).actions;
    expect(await actionsOf()).toEqual([]);

    await post("export", { kind: "script", showcaseId: "nova" });
    const job = await settled(post);
    expect(job.status).toBe("done");
    let records = await actionsOf();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      kind: "export",
      jobKind: "script",
      jobId: job.jobId,
      showcaseId: "nova",
      by: "user",
      why: "Started by you",
      label: "Script",
      state: "done",
      result: job.out,
      offers: ["reveal"],
    });
    expect(await post("actions-offer", { id: records[0].id, offer: "reveal" })).toEqual({
      ok: true,
    });
    expect(revealed).toEqual([job.out]);
    expect(await post("actions-offer", { id: records[0].id, offer: "retry" })).toMatchObject({
      ok: false,
    });

    /* An export Claude starts is Claude's, and studio_info sums the list up. */
    const started = await studio.callTool({
      name: "export",
      arguments: { kind: "script", showcaseId: "nova" },
    });
    expect(JSON.parse(started.content[0].text)).toMatchObject({ by: "claude" });
    await settled(post);
    records = await actionsOf();
    expect(records[1]).toMatchObject({ by: "claude", why: "Started by Claude", state: "done" });
    const info = JSON.parse(
      (await studio.callTool({ name: "studio_info", arguments: {} })).content[0].text,
    );
    expect(info.actions).toEqual({
      pending: 0,
      running: 0,
      failed: [],
      path: path.join(library, ".studio", "actions.jsonl"),
    });
    const lines = readFileSync(path.join(library, ".studio", "actions.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.map((l) => l.state)).toEqual(["running", "done", "running", "done"]);
    expect(lines[0]).not.toHaveProperty("progress");
  });

  it("lists a failed export with Try again and Dismiss, and tries again", async () => {
    const { studio, url, post } = await startStudio();
    const actionsOf = async () => (await (await fetch(`${url}/studio/api/actions`)).json()).actions;
    await post("export", { kind: "script", showcaseId: "ghost" });
    await settled(post);
    let [record] = await actionsOf();
    expect(record).toMatchObject({ state: "failed", offers: ["retry", "dismiss"] });
    expect(record.error).toBeTruthy();
    const info = JSON.parse(
      (await studio.callTool({ name: "studio_info", arguments: {} })).content[0].text,
    );
    expect(info.actions.failed).toEqual([
      {
        id: record.id,
        kind: "export",
        label: "Script",
        showcaseId: "ghost",
        by: "user",
        error: record.error,
      },
    ]);

    expect(await post("actions-offer", { id: record.id, offer: "dismiss" })).toEqual({ ok: true });
    [record] = await actionsOf();
    expect(record).toMatchObject({ dismissed: true, offers: ["retry"] });

    expect(await post("actions-offer", { id: record.id, offer: "retry" })).toEqual({ ok: true });
    await settled(post);
    const records = await actionsOf();
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      kind: "export",
      showcaseId: "ghost",
      by: "user",
      why: "Tried again from the Actions list",
      state: "failed",
    });
  });
});
