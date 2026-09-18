import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { presenceFile, runningStudio, writePresence } from "./studio-presence.mjs";
import { createStudio } from "./studio-server.mjs";

/* One studio per library, checked against real servers on real ports:
 * the whole question is what actually answers at an address. */

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

function library() {
  const dir = mkdtempSync(path.join(tmpdir(), "studio-presence-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }),
  );
  mkdirSync(path.join(dir, "nova"));
  writeFileSync(path.join(dir, "nova", "showcase.yaml"), "meta:\n  title: Nova\nscenes: []\n");
  return dir;
}

/** Serves `handler` on a free local port; resolves with its address. */
function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      cleanups.push(() => new Promise((done) => server.close(() => done())));
      resolve({ url, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}

/** A studio on `dir`, served over HTTP the way the launchers serve it. */
async function openStudio(dir) {
  let saved = {};
  const studio = createStudio({
    showcasesDir: dir,
    version: "test",
    settings: { load: () => saved, save: (patch) => (saved = { ...saved, ...patch }) },
    exportDir: path.join(dir, "..", "exports"),
    features: { terminal: false },
    log: () => {},
  });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await studio.close();
    await server.close();
  };
  cleanups.push(close);
  const server = await listen((req, res) =>
    studio.handle(req, res, () => {
      res.statusCode = 404;
      res.end();
    }),
  );
  studio.setUrl(server.url);
  return { studio, url: server.url, close };
}

const record = (dir) =>
  existsSync(presenceFile(dir)) ? JSON.parse(readFileSync(presenceFile(dir), "utf8")) : null;

/** An action, POSTed to a studio's API the way the page and the desktop
 *  menus send it. */
const post = async (url, action, body) =>
  (
    await fetch(`${url}/studio/api/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  ).json();

async function waitFor(check, timeout = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("runningStudio", () => {
  it("finds nothing when no studio has ever opened the library", async () => {
    expect(await runningStudio(library())).toBeNull();
  });

  it("finds a studio that is really serving this library", async () => {
    const dir = library();
    const { url } = await openStudio(dir);
    await waitFor(() => record(dir));
    expect(await runningStudio(dir)).toEqual({ url });
  });

  it("treats the record a crash left behind as free — quickly", async () => {
    const dir = library();
    /* A studio that died without cleaning up: its address answers no one. */
    const gone = await listen(() => {});
    await gone.close();
    writePresence(dir, { url: gone.url });
    const start = Date.now();
    expect(await runningStudio(dir)).toBeNull();
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("doesn't count a studio that has some other library open", async () => {
    const mine = library();
    const { url } = await openStudio(library());
    writePresence(mine, { url });
    expect(await runningStudio(mine)).toBeNull();
  });

  it("doesn't count another program that got the port after a crash", async () => {
    const dir = library();
    const other = await listen((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ hello: "not a studio" }));
    });
    writePresence(dir, { url: other.url });
    expect(await runningStudio(dir)).toBeNull();
  });

  it("gives up and calls the library free when the address hangs", async () => {
    const dir = library();
    const stuck = await listen(() => {}); // accepts, never answers
    writePresence(dir, { url: stuck.url });
    expect(await runningStudio(dir, { timeoutMs: 200 })).toBeNull();
  });

  it("ignores a record it can't read", async () => {
    const dir = library();
    mkdirSync(path.dirname(presenceFile(dir)), { recursive: true });
    writeFileSync(presenceFile(dir), "{ not json");
    expect(await runningStudio(dir)).toBeNull();
  });

  it("never finds the asking studio itself", async () => {
    const dir = library();
    const { url } = await openStudio(dir);
    await waitFor(() => record(dir));
    expect(await runningStudio(dir, { exceptUrl: url })).toBeNull();
  });
});

describe("a studio's record of the library it has open", () => {
  it("is written once the studio listens, and removed when it closes", async () => {
    const dir = library();
    const { url, close } = await openStudio(dir);
    await waitFor(() => record(dir));
    expect(record(dir)).toMatchObject({ url, pid: process.pid });
    await close();
    expect(record(dir)).toBeNull();
  });

  it("is not taken over by a second studio, and outlives that studio closing", async () => {
    const dir = library();
    const first = await openStudio(dir);
    await waitFor(() => record(dir));
    /* A second studio on the same library — a headless export does this —
     * leaves the first one's record alone. */
    const second = await openStudio(dir);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(record(dir).url).toBe(first.url);
    await second.close();
    expect(record(dir).url).toBe(first.url);
  });

  it("replaces the record a crash left behind", async () => {
    const dir = library();
    const gone = await listen(() => {});
    await gone.close();
    writePresence(dir, { url: gone.url });
    const { url } = await openStudio(dir);
    await waitFor(() => record(dir)?.url === url);
  });
});

describe("switching a studio to another folder", () => {
  it("refuses a folder another studio has open, and says where", async () => {
    const mine = library();
    const theirs = library();
    const { studio, url } = await openStudio(mine);
    const other = await openStudio(theirs);
    await waitFor(() => record(theirs));
    const result = await post(url, "library", { dir: theirs });
    expect(result.ok).toBe(false);
    expect(result.error).toContain(other.url);
    expect(studio.info().library).toBe(mine);
  });

  it("opens a folder whose only record was left by a crash, and moves its own record", async () => {
    const mine = library();
    const target = library();
    const gone = await listen(() => {});
    await gone.close();
    writePresence(target, { url: gone.url });
    const { studio, url } = await openStudio(mine);
    await waitFor(() => record(mine));

    const result = await post(url, "library", { dir: target });
    expect(result).toMatchObject({ ok: true, library: target });
    await waitFor(() => record(target)?.url === url);
    expect(record(mine)).toBeNull();
  });
});
