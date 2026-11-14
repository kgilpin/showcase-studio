import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { commitMessage, noIdentityReason, tooBigToInit } from "./showcase-history.mjs";
import { createStudio } from "./studio-server.mjs";
import { gitProgram } from "./git-program.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const DELAY = 150;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const git = (cwd, ...args) =>
  execFileSync(gitProgram(), args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** A temp folder holding a showcases library at `showcases/` with one
 *  showcase, "nova". With `repo`, the folder is a git repository with a
 *  first commit and its own identity (no global hooks or signing). */
function project({ repo = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "studio-history-"));
  /* Retries: on Windows a folder can't be removed while a git process or
   * the studio's watcher still has it open, which lasts a moment. */
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }),
  );
  const library = path.join(dir, "showcases");
  mkdirSync(path.join(library, "nova", "assets"), { recursive: true });
  writeFileSync(path.join(library, "nova", "showcase.yaml"), SHOWCASE_YAML);
  writeFileSync(path.join(dir, "notes.txt"), "notes\n");
  if (repo) {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Test User");
    git(dir, "config", "user.email", "test@example.com");
    git(dir, "config", "commit.gpgsign", "false");
    git(dir, "config", "core.hooksPath", path.join(dir, "no-hooks"));
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "start");
  }
  return { dir, library };
}

async function startStudio(
  library,
  { delay = DELAY, outsideDelay = 60_000, autoCommit, features = {} } = {},
) {
  let saved = autoCommit === undefined ? {} : { autoCommit };
  const settings = { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) };
  /* The history logs each commit it makes. Waiting for that line, rather
   * than asking git every few milliseconds, keeps the gold trace the same
   * from run to run: a polling loop runs a different number of times
   * depending on how busy the machine is. */
  let commitsLogged = 0;
  const commitWaiters = [];
  const log = (message) => {
    if (!message.startsWith("studio: committed ")) return;
    commitsLogged += 1;
    for (const waiter of commitWaiters.splice(0)) waiter();
  };
  const studio = createStudio({
    showcasesDir: library,
    version: "test",
    settings,
    exportDir: path.join(library, "..", "exports"),
    /* No file watcher, except in the tests of changes made outside the
     * studio: the studio's writes reach the history through the change
     * log, and the watcher's reload timer would race each test's end, so
     * the gold traces would record it only sometimes. */
    features: { terminal: false, watch: false, ...features },
    commitDelayMs: delay,
    outsideCommitDelayMs: outsideDelay,
    log,
  });
  cleanups.push(() => studio.close());
  const call = async (name, args) => {
    const result = await studio.callTool({ name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const post = (action, body) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 0,
        headersSent: false,
        setHeader() {},
        end: (text) => resolve(JSON.parse(text)),
      };
      const req = (async function* () {
        yield JSON.stringify(body);
      })();
      req.method = "POST";
      req.url = `/studio/api/${action}`;
      req.headers = { host: "localhost" };
      req.socket = { remoteAddress: "127.0.0.1" };
      void studio.handle(req, res, () => resolve(null));
    });
  /* A GET the same way, for /studio/api/<name>. */
  const get = (name) =>
    new Promise((resolve) => {
      const res = {
        statusCode: 0,
        headersSent: false,
        setHeader() {},
        end: (text) => resolve(JSON.parse(text)),
      };
      const req = (async function* () {})();
      req.method = "GET";
      req.url = `/studio/api/${name}`;
      req.headers = { host: "localhost" };
      req.socket = { remoteAddress: "127.0.0.1" };
      void studio.handle(req, res, () => resolve(null));
    });
  /* Resolves once the studio has logged its nth commit. */
  const committed = async (n) => {
    while (commitsLogged < n) await new Promise((resolve) => commitWaiters.push(resolve));
  };
  /* Resolves once the file watcher is reporting changes. On a Mac,
   * fs.watch starts its FSEvents stream a moment after it returns —
   * longer on a busy machine — and a file written before then is never
   * reported. So this writes a file of its own at the library's root,
   * where a change starts no commit, until the watcher reports it: the
   * page's reload event names it, 250 ms after the change. One write
   * every 500 ms, so each write's reload has time to go out. */
  const watcherReady = async ({ timeout = 10_000 } = {}) => {
    const probe = "watcher-probe.txt";
    let reported = false;
    const req = new EventEmitter();
    req.method = "GET";
    req.url = "/studio/api/events";
    req.headers = { host: "localhost" };
    req.socket = { remoteAddress: "127.0.0.1" };
    const res = {
      statusCode: 0,
      headersSent: false,
      setHeader() {},
      writeHead() {},
      write: (chunk) => {
        if (chunk.startsWith("event: reload") && chunk.includes(probe)) reported = true;
      },
      end() {},
    };
    void studio.handle(req, res, () => {});
    try {
      const start = Date.now();
      for (let i = 0; !reported; i++) {
        if (Date.now() - start > timeout) throw new Error("the file watcher never started");
        if (i % 20 === 0) writeFileSync(path.join(library, probe), `${i}\n`);
        await sleep(25);
      }
    } finally {
      req.emit("close");
    }
  };
  return { studio, call, post, get, committed, watcherReady, saved: () => saved };
}

const commits = (dir) => git(dir, "log", "--format=%s").split("\n");

/* A repository the studio starts has no identity configured in it, so
 * git takes one from the environment — which a CI runner doesn't have.
 * Set one for this test, and put the environment back afterwards. */
function withGitIdentity() {
  const was = { ...process.env };
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "Test User",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test User",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
  cleanups.push(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in was)) delete process.env[key];
    }
    Object.assign(process.env, was);
  });
}

async function waitFor(check, { timeout = 10_000 } = {}) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting");
    await sleep(25);
  }
}

const editTitle = (value) => ({
  showcaseId: "nova",
  edits: [{ field: "scene.set", sceneId: "intro", name: "title", value }],
});

/* Every test that starts a studio drives real git: making the repository,
 * the studio's own checks and commit, and each look at the log — some 30
 * git processes a test. Run by its full path (git-program.mjs) a native
 * git takes about 6 ms, and these tests finish in 0.1–2 s. A slow git
 * makes them much slower: an Intel git on an Apple silicon Mac (an old
 * Homebrew in /usr/local) runs under Rosetta at 35–130 ms a process, and
 * there they took 2–4.5 s idle and 5.7 s under load, past vitest's
 * default 5 s. The quiet period itself is only 150 ms. A commit that
 * never comes still fails: waitFor gives up at 10 s. */
const GIT_TESTS = { timeout: 20_000 };

describe("showcase history", GIT_TESTS, () => {
  it("groups a studio UI edit and an MCP edit into one commit after the quiet period", async () => {
    const { dir, library } = await project();
    const { call, post } = await startStudio(library);
    await post("scene-edit", {
      showcaseId: "nova",
      sceneId: "intro",
      field: "caption",
      captionIndex: 0,
      value: "A new line.",
    });
    await call("edit_showcase", {
      showcaseId: "nova",
      edits: [{ field: "media.asset", sceneId: "intro", value: "shot-2" }],
    });
    writeFileSync(path.join(library, "nova", "theme.yaml"), "colors:\n  primary: red\n");

    await waitFor(() => commits(dir).length === 2);
    await sleep(DELAY * 4);
    expect(commits(dir)).toEqual([
      "nova: edit intro caption 1 text, point intro at shot-2, add theme.yaml",
      "start",
    ]);
    const body = git(dir, "log", "-1", "--format=%b");
    expect(body).toContain("- edit intro caption 1 text (studio UI)");
    expect(body).toContain("- point intro at shot-2 (Claude, via edit_showcase)");
    expect(body).toContain("- add theme.yaml (files changed directly)");
    expect(git(dir, "log", "-1", "--format=%(trailers:key=Showcase-Studio,valueonly)")).toBe(
      "auto-commit",
    );
    expect(git(dir, "status", "--porcelain", "--", "showcases/nova")).toBe("");

    /* The commit is in the change log. */
    const lines = readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines.at(-1)).toMatchObject({
      source: "studio",
      showcaseId: "nova",
      kind: "commit",
      sha: git(dir, "rev-parse", "HEAD"),
      files: ["showcase.yaml", "theme.yaml"],
    });
  });

  it("commits only the showcase folder: other staged work stays staged", async () => {
    const { dir, library } = await project();
    writeFileSync(path.join(dir, "notes.txt"), "staged by the user\n");
    git(dir, "add", "notes.txt");
    writeFileSync(path.join(dir, "scratch.txt"), "not staged\n");
    const { call, committed } = await startStudio(library);
    await call("edit_showcase", editTitle("Changed"));

    await committed(1);
    expect(commits(dir)).toHaveLength(2);
    expect(git(dir, "show", "--name-only", "--format=", "HEAD")).toBe(
      "showcases/nova/showcase.yaml",
    );
    const status = git(dir, "status", "--porcelain");
    expect(status).toContain("M  notes.txt");
    expect(status).toContain("?? scratch.txt");
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("notes.txt");
  });

  /* A library that isn't in git has no history at all: nothing to
   * review, nothing to undo. The studio starts one when it first has a
   * change to commit — not when a library is merely opened. */
  it("starts a repository the first time it commits, and commits there", async () => {
    const { dir, library } = await project({ repo: false });
    withGitIdentity();
    const { call } = await startStudio(library);

    /* Opening the library leaves nothing behind. */
    const info = await call("studio_info", {});
    expect(info.history).toMatchObject({ git: false, autoCommit: false });
    expect(info.history.reason).toContain("starts one the first time");
    expect(() => git(dir, "rev-parse", "--git-dir")).toThrow();

    await call("edit_showcase", editTitle("Changed"));
    /* The repository doesn't exist yet, so asking it for commits throws
     * until the studio has made it. */
    const commitsSoFar = () => {
      try {
        return commits(library);
      } catch {
        return [];
      }
    };
    await waitFor(() => commitsSoFar().length === 1);
    expect(commitsSoFar()[0]).toContain("nova");
    expect(git(library, "show", "--name-only", "--format=", "HEAD")).toBe("nova/showcase.yaml");
    expect((await call("studio_info", {})).history).toMatchObject({
      git: true,
      autoCommit: true,
    });
  });

  it("starts none when the user has commits turned off", async () => {
    const { library } = await project({ repo: false });
    const { call } = await startStudio(library, { autoCommit: false });
    await call("edit_showcase", editTitle("Changed"));
    await sleep(DELAY * 4);

    expect(await call("commit_showcase", { showcaseId: "nova", message: "Try" })).toMatchObject({
      committed: false,
    });
    expect(() => git(library, "rev-parse", "--git-dir")).toThrow();
  });

  it("makes no commit when a branch switch leaves the showcase matching a commit", async () => {
    const { dir, library } = await project();
    git(dir, "switch", "-q", "-c", "cut");
    writeFileSync(
      path.join(library, "nova", "showcase.yaml"),
      SHOWCASE_YAML.replace("Hello", "Cut"),
    );
    git(dir, "commit", "-q", "-am", "a new cut");
    git(dir, "switch", "-q", "main");

    const { call } = await startStudio(library);
    expect((await call("studio_info", {})).history).toMatchObject({
      git: true,
      autoCommit: true,
      branch: "main",
    });
    git(dir, "switch", "-q", "cut");
    await sleep(DELAY * 6);
    git(dir, "switch", "-q", "main");
    await sleep(DELAY * 6);
    expect(git(dir, "log", "--all", "--format=%s").split("\n")).toEqual(["a new cut", "start"]);
  });

  it("waits while a merge is in progress, and commits on the next change after it", async () => {
    const { dir, library } = await project();
    const mergeHead = path.join(dir, ".git", "MERGE_HEAD");
    writeFileSync(mergeHead, `${git(dir, "rev-parse", "HEAD")}\n`);
    const { call } = await startStudio(library);
    await call("edit_showcase", editTitle("During the merge"));
    await sleep(DELAY * 4);
    expect(commits(dir)).toEqual(["start"]);
    expect((await call("studio_info", {})).history.reason).toContain("merge");
    expect(await call("commit_showcase", { showcaseId: "nova", message: "Now" })).toEqual({
      committed: false,
      reason: "Not committed: a merge is in progress.",
    });

    rmSync(mergeHead);
    await call("edit_showcase", editTitle("After the merge"));
    await waitFor(() => commits(dir).length === 2);
    expect(commits(dir)[0]).toBe("nova: edit intro title");
  });

  it("makes no timer commits in the studio Claude Code starts, and says why", async () => {
    const { dir, library } = await project();
    const { call } = await startStudio(library, { features: { autoCommit: false } });
    const { history } = await call("studio_info", {});
    expect(history).toMatchObject({
      git: true,
      autoCommit: false,
      enabled: false,
      available: true,
    });
    expect(history.reason).toContain("commit_showcase");

    await call("edit_showcase", editTitle("Unhurried"));
    await sleep(DELAY * 6);
    expect(commits(dir)).toEqual(["start"]);
  });

  it("still commits with commit_showcase there — that off stops only the timer", async () => {
    const { dir, library } = await project();
    const { call } = await startStudio(library, { features: { autoCommit: false } });
    await call("edit_showcase", editTitle("Finished"));
    const result = await call("commit_showcase", {
      showcaseId: "nova",
      message: "Retitle the intro",
    });
    expect(result).toMatchObject({ committed: true });
    expect(commits(dir)).toEqual(["nova: Retitle the intro", "start"]);
  });

  it("lets the user's own switch win over that default, either way", async () => {
    const { dir, library } = await project();
    /* Switched on: the timer commits, as in any other studio. */
    const on = await startStudio(library, { autoCommit: true, features: { autoCommit: false } });
    await on.call("edit_showcase", editTitle("Switched on"));
    await waitFor(() => commits(dir).length === 2);

    /* Switched off: everything stops, commit_showcase too. */
    const off = await startStudio(library, { autoCommit: false, features: { autoCommit: false } });
    await off.call("edit_showcase", editTitle("Switched off"));
    const refused = await off.call("commit_showcase", { showcaseId: "nova", message: "No" });
    expect(refused.committed).toBe(false);
    expect(refused.reason).toContain("switch");
  });

  it("commit_showcase commits right away with Claude's message", async () => {
    const { dir, library } = await project();
    const { call } = await startStudio(library, { delay: 60_000 });
    await call("edit_showcase", editTitle("Retimed"));
    const result = await call("commit_showcase", {
      showcaseId: "nova",
      message: "Retime scenes to the new voiceover",
    });
    expect(result).toEqual({
      committed: true,
      sha: git(dir, "rev-parse", "HEAD"),
      message: "nova: Retime scenes to the new voiceover",
      files: ["showcase.yaml"],
    });
    expect(commits(dir)).toEqual(["nova: Retime scenes to the new voiceover", "start"]);
    expect(git(dir, "log", "-1", "--format=%b")).toContain(
      "- edit intro title (Claude, via edit_showcase)",
    );
    expect(await call("commit_showcase", { showcaseId: "nova", message: "Again" })).toMatchObject({
      committed: false,
      reason: expect.stringContaining("Nothing to commit"),
    });
  });

  it("turns off with the autoCommit setting", async () => {
    const { dir, library } = await project();
    const { call, get } = await startStudio(library, { autoCommit: false });
    await call("edit_showcase", editTitle("Changed"));
    await sleep(DELAY * 4);
    expect(commits(dir)).toEqual(["start"]);
    expect((await call("studio_info", {})).history).toMatchObject({ git: true, autoCommit: false });
    expect(await call("commit_showcase", { showcaseId: "nova", message: "Try" })).toMatchObject({
      committed: false,
      reason: expect.stringContaining("turned off"),
    });
    /* The refusal is the user's own setting at work, not a failure: the
     * Actions list shows the attempt as skipped, saying why, so it never
     * sits under "Needs you". */
    const { actions } = await get("actions");
    expect(actions.filter((a) => a.kind === "commit")).toEqual([
      expect.objectContaining({
        by: "claude",
        state: "canceled",
        why: expect.stringContaining("Commits are turned off"),
      }),
    ]);
    expect((await call("studio_info", {})).actions.failed).toEqual([]);
  });
});

describe("the Commit changes to git switch", GIT_TESTS, () => {
  const settingLines = (library) =>
    readFileSync(path.join(library, ".studio", "changes.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.kind === "setting");

  it("reads the history status over GET /studio/api/history", async () => {
    const { dir, library } = await project();
    const { get } = await startStudio(library);
    expect(await get("history")).toEqual({
      git: true,
      autoCommit: true,
      enabled: true,
      available: true,
      branch: "main",
      root: expect.any(String),
    });
    expect(git(dir, "rev-parse", "--show-toplevel")).toContain(path.basename(dir));
  });

  it("turns commits off at once, saves the choice, and logs it", async () => {
    const { dir, library } = await project();
    const { call, post, get, saved } = await startStudio(library);

    const off = await post("history-auto-commit", { on: false });
    expect(off).toMatchObject({
      ok: true,
      history: { git: true, autoCommit: false, enabled: false, available: true },
    });
    expect(off.history.reason).toContain("turned off");
    expect(saved()).toMatchObject({ autoCommit: false });
    expect(await get("history")).toMatchObject({ autoCommit: false, enabled: false });
    expect(settingLines(library)).toEqual([
      {
        at: expect.any(String),
        source: "ui",
        showcaseId: null,
        kind: "setting",
        name: "autoCommit",
        value: false,
      },
    ]);

    /* A change while it's off makes no commit. */
    await call("edit_showcase", editTitle("While off"));
    await sleep(DELAY * 4);
    expect(commits(dir)).toEqual(["start"]);

    /* Back on: the next change commits, and that is logged too. */
    expect(await post("history-auto-commit", { on: true })).toMatchObject({
      ok: true,
      history: { autoCommit: true, enabled: true },
    });
    await call("edit_showcase", editTitle("Back on"));
    await waitFor(() => commits(dir).length === 2);
    expect(settingLines(library).map((entry) => entry.value)).toEqual([false, true]);
  });

  it("drops a commit that was waiting when commits are turned off", async () => {
    const { dir, library } = await project();
    const { call, post } = await startStudio(library, { delay: DELAY * 3 });
    await call("edit_showcase", editTitle("Waiting"));
    await sleep(DELAY);
    await post("history-auto-commit", { on: false });
    /* Turned back on before the wait ends: the dropped commit stays dropped. */
    await post("history-auto-commit", { on: true });
    await sleep(DELAY * 6);
    expect(commits(dir)).toEqual(["start"]);
  });

  it("refuses anything but true or false, and logs nothing for it", async () => {
    const { library } = await project();
    const { post, saved } = await startStudio(library);
    expect(await post("history-auto-commit", { on: "yes" })).toMatchObject({ ok: false });
    expect(saved()).toEqual({});
    expect(existsSync(path.join(library, ".studio", "changes.jsonl"))).toBe(false);
  });

  it("says why the switch can't work outside a git repository", async () => {
    const { library } = await project({ repo: false });
    const { get } = await startStudio(library);
    const status = await get("history");
    expect(status).toMatchObject({
      git: false,
      autoCommit: false,
      enabled: true,
      available: false,
      branch: null,
    });
    expect(status.reason).toContain("starts one the first time it commits");
  });

  it("says why the switch can't work when .gitignore hides the library", async () => {
    const { dir, library } = await project();
    git(dir, "rm", "-r", "-q", "--cached", "showcases");
    writeFileSync(path.join(dir, ".gitignore"), "showcases/\n");
    git(dir, "add", ".gitignore");
    git(dir, "commit", "-q", "-m", "ignore the library");
    const { get } = await startStudio(library);
    const status = await get("history");
    expect(status).toMatchObject({ git: true, autoCommit: false, enabled: true, available: false });
    expect(status.reason).toContain(".gitignore");
  });
});

describe("commitMessage", () => {
  it("names changed files no log entry explains, grouped by what happened", () => {
    const { subject, text } = commitMessage({
      showcaseId: "gold-traces",
      files: [
        { verb: "edit", file: "theme.yaml" },
        { verb: "edit", file: "graphics/risk.tsx" },
        { verb: "add", file: "assets/shot.png" },
      ],
    });
    expect(subject).toBe("gold-traces: edit theme.yaml, graphics/risk.tsx; add assets/shot.png");
    expect(text.endsWith("\n\nShowcase-Studio: auto-commit")).toBe(true);
  });

  it("counts files instead of naming them when the names don't fit", () => {
    /* The migration that motivated this: three groups of files, and a
     * subject that named only the first group — past the limit — and
     * hid a whole migration behind "and 2 more". */
    const files = [
      ...["shot-manifest.png", "shot-sanitize.png", "shot-sql.png"].map((f) => `assets/${f}`),
      ...["absence", "deterministic", "side-effects"].map((f) => `graphics/${f}.tsx`),
    ].map((file) => ({ verb: "delete", file }));
    files.push(
      ...["graphics/lifecycle.tsx", "showcase.yaml", "theme.yaml"].map((file) => ({
        verb: "edit",
        file,
      })),
      ...["checks", "hook", "onlook-recordings", "proof", "review", "risk", "safe"].map((f) => ({
        verb: "add",
        file: `graphics/${f}.tsx`,
      })),
    );
    const { subject, body } = commitMessage({ showcaseId: "gold-traces", files });
    expect(subject).toBe("gold-traces: delete 6 files, edit 3 files, add 7 graphics");
    expect(subject.length).toBeLessThanOrEqual(72);
    /* Every name is still in the body. */
    expect(body).toContain("graphics/side-effects.tsx");
    expect(body).toContain("graphics/onlook-recordings.tsx");
  });

  it("counts assets added through the studio the same way", () => {
    const names = Array.from({ length: 9 }, (_, i) => `screenshot-${i + 1}.png`);
    const { subject } = commitMessage({
      showcaseId: "nova",
      entries: [{ source: "ui", showcaseId: "nova", kind: "asset.add", names }],
    });
    expect(subject).toBe("nova: add 9 assets");
  });

  it("names the tool a saved transcript came through", () => {
    const { subject, body } = commitMessage({
      showcaseId: "nova",
      entries: [
        {
          source: "mcp",
          tool: "transcribe",
          showcaseId: "nova",
          kind: "transcript",
          file: "assets/take-1.transcript.json",
        },
      ],
    });
    expect(subject).toBe("nova: save the transcript assets/take-1.transcript.json");
    expect(body).toContain("(Claude, via transcribe)");
  });

  it("keeps the subject short, counting what it leaves out", () => {
    const edits = ["intro", "risk", "hook", "outro", "cta", "demo"].map((sceneId) => ({
      field: "scene.set",
      sceneId,
      name: "title",
    }));
    const { subject, body } = commitMessage({
      showcaseId: "nova",
      entries: [{ source: "ui", showcaseId: "nova", kind: "edit", file: "showcase.yaml", edits }],
      files: [{ verb: "edit", file: "showcase.yaml" }],
    });
    expect(subject.length).toBeLessThanOrEqual(72);
    expect(subject).toMatch(/^nova: edit intro title, edit risk title, .*, and \d more$/);
    expect(body.split("\n")).toHaveLength(7);
  });
});

describe("where the studio won't start a repository", () => {
  /* A repository at one of these would take in everything the user owns,
   * and the first `git add` would be a disaster to undo. */
  it("refuses a volume root, the home folder, and anything above it", () => {
    const home = path.join(path.parse(process.cwd()).root, "Users", "sam");
    expect(tooBigToInit(home, home)).toBe("your home folder");
    expect(tooBigToInit(path.parse(process.cwd()).root, home)).toBe("a volume's root folder");
    expect(tooBigToInit(path.dirname(home), home)).toBe("a folder that contains your home folder");
  });

  it("is fine with a folder of one's own", () => {
    const home = path.join(path.parse(process.cwd()).root, "Users", "sam");
    expect(tooBigToInit(path.join(home, "showcases"), home)).toBeUndefined();
    expect(tooBigToInit(path.join(home, "work", "demo", "showcases"), home)).toBeUndefined();
  });
});

describe("when git doesn't know who the user is", () => {
  /* git's own message is six lines of shell examples, and someone who has
   * never used git meets it the first time the studio saves their work. */
  it("gives the two commands to run, for either way git says it", () => {
    for (const said of [
      "Author identity unknown\n*** Please tell me who you are.\n\nrun\n  git config ...",
      "fatal: unable to auto-detect email address (got 'sam@laptop.(none)')",
    ]) {
      const reason = noIdentityReason(said);
      expect(reason).toContain("git config --global user.name");
      expect(reason).toContain("git config --global user.email");
      expect(reason).not.toContain("***");
    }
  });

  it("leaves every other failure to be reported as it is", () => {
    expect(noIdentityReason("error: pathspec 'nova' did not match any file(s)")).toBeUndefined();
  });
});

describe("commits in the Actions list", GIT_TESTS, () => {
  it("shows the quiet period, then the commit; a skip stops it; Try again commits", async () => {
    const { dir, library } = await project();
    const { call, post, get, committed } = await startStudio(library);

    await call("edit_showcase", editTitle("Hello there"));
    let { actions } = await get("actions");
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "commit",
      showcaseId: "nova",
      by: "studio",
      why: "nova changed",
      label: "Commit to git",
      state: "pending",
      offers: ["skip"],
    });
    expect(Date.parse(actions[0].dueAt)).toBeGreaterThan(Date.now() - DELAY);

    await committed(1);
    ({ actions } = await get("actions"));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      state: "done",
      result: {
        sha: git(dir, "rev-parse", "HEAD"),
        message: "nova: edit intro title",
        files: ["showcase.yaml"],
      },
      offers: [],
    });

    /* Skipping the quiet period makes no commit; the record says so. */
    await call("edit_showcase", editTitle("Again"));
    ({ actions } = await get("actions"));
    const waiting = actions.find((a) => a.state === "pending");
    expect(await post("actions-offer", { id: waiting.id, offer: "skip" })).toEqual({ ok: true });
    await sleep(DELAY * 3);
    expect(commits(dir)).toHaveLength(2);
    ({ actions } = await get("actions"));
    expect(actions.find((a) => a.id === waiting.id)).toMatchObject({
      state: "canceled",
      offers: ["retry"],
    });

    /* Try again commits now, as the user's own record. */
    expect(await post("actions-offer", { id: waiting.id, offer: "retry" })).toEqual({ ok: true });
    await committed(2);
    ({ actions } = await get("actions"));
    expect(actions.at(-1)).toMatchObject({
      kind: "commit",
      by: "user",
      why: "Tried again from the Actions list",
      state: "done",
      result: { message: "nova: edit intro title" },
    });
    expect(commits(dir)).toHaveLength(3);

    /* commit_showcase folds the waiting commit into Claude's own. */
    await call("edit_showcase", editTitle("Third"));
    await call("commit_showcase", { showcaseId: "nova", message: "third title" });
    ({ actions } = await get("actions"));
    expect(actions.filter((a) => a.state === "pending")).toEqual([]);
    expect(actions.at(-1)).toMatchObject({
      kind: "commit",
      by: "claude",
      why: "third title",
      state: "done",
      result: { message: "nova: third title" },
    });
  });

  it("keeps no record while commits are off, and skips the waiting ones when turned off", async () => {
    const { library } = await project();
    const { call, post, get } = await startStudio(library, { features: { autoCommit: false } });
    await call("edit_showcase", editTitle("Quiet"));
    expect((await get("actions")).actions).toEqual([]);
    /* Nor after the quiet period: the timer finds commits off and adds
     * no failed "commits are turned off" record. */
    await sleep(DELAY * 3);
    expect((await get("actions")).actions).toEqual([]);

    await post("history-auto-commit", { on: true });
    await call("edit_showcase", editTitle("Louder"));
    let { actions } = await get("actions");
    expect(actions.map((a) => a.state)).toEqual(["pending"]);
    await post("history-auto-commit", { on: false });
    ({ actions } = await get("actions"));
    expect(actions.map((a) => a.state)).toEqual(["canceled"]);
  });
});

describe("changes made outside the studio", GIT_TESTS, () => {
  /* An editor, a git checkout, a Claude session's own file tools: the
   * file watcher sees them, and they get a longer quiet period than the
   * studio's own writes. Longer than the watcher's own delay (about
   * 250 ms, plus the time the system takes to report a change). */
  const OUTSIDE = 900;
  const watching = async (library, options = {}) => {
    const studio = await startStudio(library, {
      outsideDelay: OUTSIDE,
      ...options,
      features: { watch: true, ...options.features },
    });
    await studio.watcherReady();
    return studio;
  };
  const theme = (library, color = "red") =>
    writeFileSync(path.join(library, "nova", "theme.yaml"), `colors:\n  primary: ${color}\n`);

  it("commits them after the longer quiet period, naming the files", async () => {
    const { dir, library } = await project();
    const { get, committed } = await watching(library);
    theme(library);

    /* Not after the studio's short one. */
    await sleep(DELAY * 3);
    expect(commits(dir)).toEqual(["start"]);
    await committed(1);
    expect(commits(dir)[0]).toBe("nova: add theme.yaml");
    expect(git(dir, "log", "-1", "--format=%b")).toContain(
      "- add theme.yaml (files changed directly)",
    );
    expect(git(dir, "status", "--porcelain", "--", "showcases/nova")).toBe("");

    const { actions } = await get("actions");
    expect(actions).toEqual([
      expect.objectContaining({
        kind: "commit",
        showcaseId: "nova",
        by: "studio",
        why: "Files in nova changed outside the studio",
        state: "done",
        result: expect.objectContaining({ message: "nova: add theme.yaml" }),
      }),
    ]);
  });

  it("starts the quiet period again on each further change", async () => {
    const { dir, library } = await project();
    await watching(library);
    theme(library);
    await sleep(OUTSIDE / 2);
    writeFileSync(path.join(library, "nova", "assets", "note.txt"), "a note\n");
    /* Past the first change's deadline, but not the second's. */
    await sleep(OUTSIDE * 0.75);
    expect(commits(dir)).toEqual(["start"]);
    await waitFor(() => commits(dir).length === 2);
    expect(git(dir, "show", "--name-only", "--format=", "HEAD").split("\n").sort()).toEqual([
      "showcases/nova/assets/note.txt",
      "showcases/nova/theme.yaml",
    ]);
  });

  it("makes one commit of a studio write and an outside change in the same window", async () => {
    const { dir, library } = await project();
    /* A studio quiet period longer than the watcher takes to report a
     * change, as the real 5 s is: the watcher also reports the studio's
     * own write to showcase.yaml (edit_showcase's writes aren't swallowed
     * as echoes, so the page re-reads them), and that report must land
     * while the studio's commit still waits, where it rides along. */
    const outside = 1500;
    const { call, get } = await watching(library, { delay: 700, outsideDelay: outside });
    theme(library);
    await sleep(DELAY * 3);
    await call("edit_showcase", editTitle("Together"));
    /* The studio's shorter period takes over and commits both. */
    await waitFor(() => commits(dir).length === 2);
    expect(commits(dir)[0]).toBe("nova: edit intro title, add theme.yaml");
    /* And no second commit, nor a second record, when the longer period
     * would have ended. */
    await sleep(outside * 1.5);
    expect(commits(dir)).toHaveLength(2);
    const { actions } = await get("actions");
    expect(actions.filter((a) => a.kind === "commit").map((a) => a.state)).toEqual(["done"]);
  });

  it("commits nothing while automatic commits are off", async () => {
    const { dir, library } = await project();
    const { get } = await watching(library, { features: { autoCommit: false } });
    theme(library);
    await sleep(OUTSIDE * 2);
    expect(commits(dir)).toEqual(["start"]);
    expect((await get("actions")).actions).toEqual([]);
  });

  it("ignores .studio/ and files at the library's root", async () => {
    const { dir, library } = await project();
    const { get } = await watching(library);
    mkdirSync(path.join(library, "nova", ".studio"), { recursive: true });
    writeFileSync(path.join(library, "nova", ".studio", "cache.json"), "{}\n");
    writeFileSync(path.join(library, ".studio", "scratch.json"), "{}\n");
    writeFileSync(path.join(library, "notes.md"), "library notes\n");
    await sleep(OUTSIDE * 2);
    expect(commits(dir)).toEqual(["start"]);
    expect((await get("actions")).actions.filter((a) => a.kind === "commit")).toEqual([]);
  });
});
