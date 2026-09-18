import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPageError, pageErrorField, recordPageError } from "../src/lib/page-error.mjs";
import { createStudioMcp, serveStudioMcp } from "./mcp-stdio.mjs";
import { presenceFile } from "./studio-presence.mjs";
import { createStudio } from "./studio-server.mjs";

const dirs = [];
/** A library folder holding the named showcases (each with a showcase.yaml). */
function library(...ids) {
  const dir = mkdtempSync(path.join(tmpdir(), "mcp-stdio-"));
  dirs.push(dir);
  for (const id of ids) {
    mkdirSync(path.join(dir, id));
    writeFileSync(path.join(dir, id, "showcase.yaml"), "meta:\n  title: Demo\nscenes: []\n");
  }
  return dir;
}

afterEach(() => {
  clearPageError();
  /* Retries: on Windows a folder can't be removed while the studio's
   * watcher still has it open, which lasts a moment. */
  while (dirs.length) {
    rmSync(dirs.pop(), { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
  }
});

/** Stands in for a real studio, and records how each one was started and
 *  whether it was stopped. */
function fakeStudios() {
  const started = [];
  const startStudio = async ({ showcasesDir, lock, window, source }) => {
    const entry = { showcasesDir, lock, window, source, closed: false };
    started.push(entry);
    const text = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
    return {
      studio: {
        /* studio_info answers as the real one does (server/mcp.mjs),
         * page error included. */
        callTool: async ({ name }) =>
          name === "studio_info"
            ? text({ library: showcasesDir, lock, ...pageErrorField() })
            : text({ tool: name, library: showcasesDir }),
      },
      url: "http://localhost:1234",
      landingUrl: () => `http://localhost:1234${lock ? `/showcase/${lock.showcaseId}` : ""}`,
      close: async () => {
        entry.closed = true;
      },
    };
  };
  return { started, startStudio };
}

function server(options) {
  const { rpc, shutdown } = createStudioMcp({
    version: "1.0.0",
    cwd: "/",
    log: () => {},
    ...options,
  });
  let id = 0;
  const call = async (name, args) =>
    (
      await rpc({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      })
    ).result;
  const read = (result) => JSON.parse(result.content[0].text);
  return { rpc, shutdown, call, read };
}

describe("the studio's MCP server", () => {
  it("offers the window choice only when the program can show a window", async () => {
    for (const windows of [false, true]) {
      const { rpc } = server({ ...fakeStudios(), defaultLibrary: () => "/lib", windows });
      const { result } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const names = result.tools.map((tool) => tool.name);
      expect(names).toEqual(
        expect.arrayContaining(["studio_start", "studio_stop", "edit_showcase"]),
      );
      const start = result.tools.find((tool) => tool.name === "studio_start");
      expect("window" in start.inputSchema.properties).toBe(windows);
    }
  });

  it("starts a studio locked to a showcase, in a window when asked, and returns the page to open", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib, windows: true });
    const lock = { kind: "showcase", showcaseId: "nova" };
    expect(read(await call("studio_start", { showcase: "nova", window: true }))).toEqual({
      library: lib,
      lock,
      open: "http://localhost:1234/showcase/nova",
      guide: path.join(lib, ".studio", "GUIDE.md"),
      changes: path.join(lib, ".studio", "changes.jsonl"),
    });
    expect(started).toEqual([{ showcasesDir: lib, lock, window: true, closed: false }]);
  });

  it("adds the last page error to studio_start's result", async () => {
    const lib = library("nova");
    const { call, read } = server({ ...fakeStudios(), defaultLibrary: () => lib });
    expect(read(await call("studio_start", {}))).not.toHaveProperty("pageError");
    recordPageError(new Error("boom"), { path: "/" });
    expect(read(await call("studio_start", {})).pageError).toMatchObject({
      message: "boom",
      path: "/",
    });
  });

  it("never asks for a window when the program can't show one", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const { call } = server({ startStudio, defaultLibrary: () => lib });
    await call("studio_start", { showcase: "nova", window: true });
    expect(started[0].window).toBe(false);
  });

  it("restarts the studio for new choices, and leaves it running when a choice is wrong", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const { call } = server({ startStudio, defaultLibrary: () => lib });
    await call("studio_start", { showcase: "nova" });

    const wrong = await call("studio_start", { showcase: "missing" });
    expect(wrong.isError).toBe(true);
    expect(wrong.content[0].text).toMatch(/not a showcase folder/);
    expect(started).toHaveLength(1);
    expect(started[0].closed).toBe(false);

    await call("studio_start", { new: true });
    expect(started[0].closed).toBe(true);
    expect(started[1]).toMatchObject({ showcasesDir: lib, lock: { kind: "new" }, window: false });
  });

  it("resolves a relative library against the working folder", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const { call } = server({
      startStudio,
      cwd: path.dirname(lib),
      defaultLibrary: () => "/unused",
    });
    await call("studio_start", { library: path.basename(lib), showcase: "nova" });
    expect(started[0]).toMatchObject({ showcasesDir: lib, lock: { showcaseId: "nova" } });
  });

  it("runs another checkout, with its own showcases, when given a source", async () => {
    const checkout = library("nova");
    mkdirSync(path.join(checkout, "scripts"));
    writeFileSync(path.join(checkout, "scripts", "dev.mjs"), "");
    const { started, startStudio } = fakeStudios();
    const libraries = [];
    const { rpc, call } = server({
      startStudio,
      sources: true,
      defaultLibrary: (source) => {
        libraries.push(source);
        return checkout;
      },
    });
    const { result } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const start = result.tools.find((tool) => tool.name === "studio_start");
    expect("source" in start.inputSchema.properties).toBe(true);

    await call("studio_start", { source: checkout, showcase: "nova" });
    expect(libraries).toEqual([checkout]);
    expect(started[0]).toMatchObject({ showcasesDir: checkout, source: checkout });

    const notACheckout = await call("studio_start", { source: library() });
    expect(notACheckout.isError).toBe(true);
    expect(notACheckout.content[0].text).toMatch(/isn't a checkout of Showcase Studio/);
    expect(started).toHaveLength(1);
  });

  it("offers no source choice where there is only one build to run", async () => {
    const { rpc } = server({ ...fakeStudios(), defaultLibrary: () => "/lib" });
    const { result } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const start = result.tools.find((tool) => tool.name === "studio_start");
    expect("source" in start.inputSchema.properties).toBe(false);
  });

  it("starts an unlocked studio for the first other tool, and stops it when asked", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });

    expect(read(await call("studio_info"))).toEqual({
      library: lib,
      lock: null,
      open: "http://localhost:1234",
    });
    expect(started).toHaveLength(1);
    expect(started[0].lock).toBeNull();

    expect(read(await call("studio_stop"))).toEqual({ stopped: true });
    expect(started[0].closed).toBe(true);
    expect(read(await call("studio_stop"))).toEqual({ stopped: false });
  });
});

describe("a studio that already has the library open", () => {
  /* Real studios on real ports (as in studio-presence.test.mjs): what
   * answers at the address in .studio/studio.json is the whole question. */
  const closers = [];
  afterEach(async () => {
    while (closers.length) await closers.pop()();
  });

  /** The user's studio on `dir`, served the way the launchers serve it;
   *  resolves once it has recorded itself in the library. */
  async function usersStudio(dir, lock = null) {
    let saved = {};
    const studio = createStudio({
      showcasesDir: dir,
      lock,
      version: "users-1.0",
      settings: { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) },
      exportDir: path.join(dir, ".exports"),
      features: { terminal: false },
      log: () => {},
    });
    const server = http.createServer((req, res) =>
      studio.handle(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      await studio.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    };
    closers.push(close);
    studio.setUrl(url);
    await vi.waitFor(() => expect(existsSync(presenceFile(dir))).toBe(true));
    return { url, close };
  }

  it("uses it instead of starting a second one, and only lets go of it on stop", async () => {
    const lib = library("nova");
    const users = await usersStudio(lib);
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });

    const result = read(await call("studio_start", { showcase: "nova" }));
    expect(result).toMatchObject({
      shared: true,
      version: "users-1.0",
      library: lib,
      open: `${users.url}/showcase/nova`,
    });
    expect(started).toEqual([]);

    // The other tools run in that studio too.
    expect(read(await call("studio_info"))).toMatchObject({
      version: "users-1.0",
      open: `${users.url}/showcase/nova`,
    });

    expect(read(await call("studio_stop"))).toEqual({ stopped: true });
    expect((await fetch(`${users.url}/studio/api/info`)).ok).toBe(true);
  });

  it("says so when that studio is locked to another showcase, and starts nothing", async () => {
    const lib = library("nova", "vega");
    await usersStudio(lib, { kind: "showcase", showcaseId: "vega" });
    const { started, startStudio } = fakeStudios();
    const { call } = server({ startStudio, defaultLibrary: () => lib });

    const result = await call("studio_start", { showcase: "nova" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/locked to the showcase "vega"/);
    expect(started).toEqual([]);
  });

  it("starts its own studio, with the same choices, when that one closes", async () => {
    const lib = library("nova");
    const users = await usersStudio(lib);
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });
    await call("studio_start", { showcase: "nova" });

    await users.close();
    expect(read(await call("studio_info"))).toMatchObject({
      library: lib,
      open: "http://localhost:1234/showcase/nova",
    });
    expect(started).toEqual([
      {
        showcasesDir: lib,
        lock: { kind: "showcase", showcaseId: "nova" },
        window: false,
        closed: false,
      },
    ]);
  });

  it("doesn't mistake its own studio for another one when it restarts", async () => {
    const lib = library("nova");
    const asked = [];
    const findStudio = async (library, { exceptUrl }) => {
      asked.push(exceptUrl);
      return null;
    };
    const { call } = server({ ...fakeStudios(), findStudio, defaultLibrary: () => lib });
    await call("studio_start", { showcase: "nova" });
    await call("studio_start", {});
    expect(asked).toEqual([undefined, "http://localhost:1234"]);
  });
});

describe("serveStudioMcp", () => {
  it("answers one message per line, and stops the studio when the input closes", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    const input = new PassThrough();
    const sent = [];
    let exited;
    const exit = new Promise((resolve) => {
      exited = resolve;
    });
    serveStudioMcp({
      input,
      send: (text) => sent.push(JSON.parse(text)),
      onExit: exited,
      version: "1.0.0",
      cwd: "/",
      log: () => {},
      startStudio,
      defaultLibrary: () => lib,
    });

    const message = (id, method, params) =>
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    input.write(message(1, "initialize", {}));
    input.write("not json\n");
    input.write(
      message(2, "tools/call", { name: "studio_start", arguments: { showcase: "nova" } }),
    );
    await vi.waitFor(() => expect(sent).toHaveLength(3));

    expect(sent.find((reply) => reply.id === 1).result.serverInfo.name).toBe("showcase-studio");
    expect(sent.find((reply) => reply.id === null).error.code).toBe(-32700);
    expect(started[0].closed).toBe(false);

    input.end();
    await exit;
    expect(started[0].closed).toBe(true);
  });
});
