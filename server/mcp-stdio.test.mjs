import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPageError, pageErrorField, recordPageError } from "../src/lib/page-error.mjs";
import { createStudioMcp, serveStudioMcp } from "./mcp-stdio.mjs";
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

  it("says which library it uses, and why", async () => {
    const lib = library("nova");
    const { startStudio } = fakeStudios();
    const reason = "the folder Claude Code runs in, which holds showcases";
    const { call, read } = server({
      startStudio,
      defaultLibrary: () => ({ library: lib, reason }),
    });
    expect(read(await call("studio_start", { new: true }))).toMatchObject({
      library: lib,
      libraryReason: reason,
    });
    expect(read(await call("studio_start", { library: lib }))).toMatchObject({
      libraryReason: "the folder studio_start was given",
    });
  });

  it("starts nothing when the user has to choose the library, then makes the folder they choose", async () => {
    const project = library();
    const suggested = path.join(project, "showcases");
    const ask = { folder: project, why: "other files", suggested };
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => ({ ask }) });

    const answer = read(await call("studio_start", { new: true }));
    expect(answer).toMatchObject({ started: false, chooseLibrary: ask });
    expect(answer.next).toContain(suggested);
    const other = await call("validate");
    expect(other.isError).toBe(true);
    expect(other.content[0].text).toMatch(/choose the showcases folder/);
    expect(started).toHaveLength(0);

    await call("studio_start", { new: true, library: suggested });
    expect(existsSync(suggested)).toBe(true);
    expect(started[0]).toMatchObject({ showcasesDir: suggested, lock: { kind: "new" } });
    /* Only one level is made: a mistyped path isn't. */
    const typo = await call("studio_start", { library: path.join(project, "a", "b") });
    expect(typo.isError).toBe(true);
    expect(existsSync(path.join(project, "a"))).toBe(false);
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

  it("starts a new studio with the same choices when the running one stops answering", async () => {
    const lib = library("nova");
    const { started, startStudio } = fakeStudios();
    let crashed = false;
    const { call, read } = server({
      defaultLibrary: () => lib,
      startStudio: async (options) => {
        const studio = await startStudio(options);
        if (started.length > 1) return studio;
        // The first one is a child studio that crashes after it starts.
        const answer = studio.studio.callTool;
        studio.studio.callTool = async (params) => {
          if (crashed) {
            throw Object.assign(new Error("The studio isn't answering"), { unreachable: true });
          }
          return answer(params);
        };
        return studio;
      },
    });
    await call("studio_start", { showcase: "nova" });

    crashed = true;
    expect(read(await call("validate"))).toEqual({ tool: "validate", library: lib });
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ lock: { kind: "showcase", showcaseId: "nova" } });
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

/* ---------- another studio already has the library open ---------- */

const closers = [];
afterEach(async () => {
  while (closers.length) await closers.pop()();
});

/** A real studio on `dir`, served on a real port, the way the launchers
 *  serve one — the check asks what answers at an address, so a stand-in
 *  won't do. Resolves once the studio has recorded itself. */
async function serveStudio(dir) {
  const studio = createStudio({
    showcasesDir: dir,
    version: "test",
    settings: { load: () => ({}), save: () => {} },
    exportDir: path.join(dir, "..", "exports"),
    features: { terminal: false },
    log: () => {},
  });
  const server = createServer((req, res) =>
    studio.handle(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  /* Safe to call twice: studio_stop closes it, then cleanup does. */
  let closing;
  const close = () =>
    (closing ??= (async () => {
      await studio.close();
      await new Promise((resolve) => server.close(resolve));
    })());
  closers.push(close);
  studio.setUrl(url);
  const note = path.join(dir, ".studio", "studio.json");
  const start = Date.now();
  while (!existsSync(note) || !readFileSync(note, "utf8").includes(url)) {
    if (Date.now() - start > 3000) throw new Error("the studio never recorded itself");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { studio, url, close };
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A git repository holding a library at showcases/ with one showcase,
 *  committed. Its own identity, and no global hooks or signing. */
function repo({ ignoreLibrary = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "mcp-stdio-repo-"));
  dirs.push(root);
  const lib = path.join(root, "showcases");
  mkdirSync(path.join(lib, "nova", "assets"), { recursive: true });
  writeFileSync(path.join(lib, "nova", "showcase.yaml"), "meta:\n  title: Nova\nscenes: []\n");
  /* What a studio scaffolds, committed as a real library would have it. */
  writeFileSync(path.join(lib, ".gitignore"), ".DS_Store\n.studio/\n");
  if (ignoreLibrary) writeFileSync(path.join(root, ".gitignore"), "showcases/\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "core.hooksPath", path.join(root, "no-hooks"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  /* The repository's top folder as git itself reports it — what the
   * studio compares against. On Windows a temp folder arrives as its
   * short DOS name (RUNNER~1) that realpathSync leaves alone, while git
   * answers with the long name and forward slashes. */
  return { root: git(root, "rev-parse", "--show-toplevel"), lib };
}

describe("studio_start when another studio has the library open", () => {
  it("starts nothing outside git, and asks the user to choose", async () => {
    const lib = library("nova");
    const other = await serveStudio(lib);
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });

    const answer = read(await call("studio_start"));
    expect(answer).toMatchObject({ started: false, alreadyOpen: { url: other.url }, git: null });
    expect(answer.next).toContain(other.url);
    expect(answer.next).toContain("alongside: true");
    expect(started).toHaveLength(0);
  });

  it("offers a worktree in git, naming what the copy won't have", async () => {
    const { root, lib } = repo();
    await serveStudio(lib);
    /* A recording kept out of git, and an edit not committed yet. */
    writeFileSync(path.join(lib, "nova", "assets", "take.mp4"), Buffer.alloc(2_000_000));
    writeFileSync(path.join(lib, "nova", "showcase.yaml"), "meta:\n  title: Nova 2\nscenes: []\n");
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });

    const answer = read(await call("studio_start"));
    expect(started).toHaveLength(0);
    expect(answer.git).toMatchObject({
      root,
      library: "showcases",
      /* The studio's own .studio/ files are not part of the showcases. */
      notInGit: { count: 1, bytes: 2_000_000, files: ["nova/assets/take.mp4"] },
      uncommitted: { count: 1, files: ["nova/showcase.yaml"] },
    });
    expect(answer.git.worktree.add).toBe(
      `git -C ${root} worktree add -b <branch> ${path.join(root, ".claude", "worktrees", "<name>")} HEAD`,
    );
    expect(answer.git.worktree.library).toBe(
      path.join(root, ".claude", "worktrees", "<name>", "showcases"),
    );
    expect(answer.next).toContain("worktree");
    expect(answer.next).toContain("1 showcase file(s) git doesn't track (2 MB");
    expect(answer.next).toContain("uncommitted changes to 1 file(s)");
  });

  it("offers no worktree when git ignores the library — a copy wouldn't have it", async () => {
    const { lib } = repo({ ignoreLibrary: true });
    await serveStudio(lib);
    const { startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });
    expect(read(await call("studio_start")).git).toBeNull();
  });

  it("runs a second studio when the user chooses it, and doesn't ask again to restart it", async () => {
    const lib = library("nova");
    await serveStudio(lib);
    const { started, startStudio } = fakeStudios();
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });

    expect(read(await call("studio_start", { alongside: true })).library).toBe(lib);
    expect(read(await call("studio_start", { showcase: "nova" })).lock).toEqual({
      kind: "showcase",
      showcaseId: "nova",
    });
    expect(started).toHaveLength(2);
  });

  it("isn't got around by calling another tool first", async () => {
    const lib = library("nova");
    const other = await serveStudio(lib);
    const { started, startStudio } = fakeStudios();
    const { call } = server({ startStudio, defaultLibrary: () => lib });

    const result = await call("validate");
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(other.url);
    expect(result.content[0].text).toContain("studio_start");
    expect(started).toHaveLength(0);
  });

  it("starts as usual when the only record was left by a crash", async () => {
    const lib = library("nova");
    mkdirSync(path.join(lib, ".studio"));
    /* An address nothing answers at: a studio that died without cleaning up. */
    const gone = createServer();
    await new Promise((resolve) => gone.listen(0, "127.0.0.1", resolve));
    const deadUrl = `http://127.0.0.1:${gone.address().port}`;
    await new Promise((resolve) => gone.close(resolve));
    writeFileSync(path.join(lib, ".studio", "studio.json"), JSON.stringify({ url: deadUrl }));
    const { started, startStudio } = fakeStudios();
    const { call } = server({ startStudio, defaultLibrary: () => lib });

    await call("studio_start");
    expect(started).toHaveLength(1);
  });

  it("never counts this session's own studio as the other one", async () => {
    const lib = library("nova");
    /* Real studios this time, so this session's own one records itself. */
    const startStudio = async ({ showcasesDir }) => {
      const { studio, url, close } = await serveStudio(showcasesDir);
      return { studio, url, landingUrl: () => url, close };
    };
    const { call, read } = server({ startStudio, defaultLibrary: () => lib });
    expect(read(await call("studio_start")).started).toBeUndefined();
    /* Restarting it with other choices is not "another studio". */
    const again = read(await call("studio_start", { showcase: "nova" }));
    expect(again.started).toBeUndefined();
    expect(again.library).toBe(lib);
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
