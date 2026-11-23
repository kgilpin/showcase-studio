import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { curlArgs, ensureModel } from "./whisper-model.mjs";

let dir;
let target;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "whisper-model-"));
  target = path.join(dir, "whisper", "ggml-base.en.bin");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/* A download the test finishes or fails by hand. */
function controlledDownload() {
  const calls = [];
  const download = (url, file, { signal } = {}) =>
    new Promise((resolve, reject) => {
      const call = {
        file,
        finish: () => {
          writeFileSync(file, "model");
          resolve();
        },
        fail: () => reject(new Error("network down")),
      };
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      calls.push(call);
    });
  return { download, calls };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/* A local server: /model redirects to /cdn/model, like Hugging Face does
 * to its CDN. /stall sends a few bytes and then nothing. */
async function startServer() {
  const server = createServer((request, response) => {
    if (request.url === "/model") {
      response.writeHead(302, { location: "/cdn/model" });
      response.end();
    } else if (request.url === "/cdn/model") {
      response.end("the model bytes");
    } else if (request.url === "/stall") {
      response.writeHead(200, { "content-length": "1000000" });
      response.write("start");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

describe("the speech model download", () => {
  it("has no limit on total time, only on a stalled transfer", () => {
    const args = curlArgs("https://example.com/m", "/tmp/m.partial");
    expect(args).not.toContain("--max-time");
    expect(args).toEqual(expect.arrayContaining(["--speed-limit", "--speed-time"]));
  });

  it("downloads with curl from PATH and follows the redirect", async () => {
    const server = await startServer();
    try {
      const file = await ensureModel({ target, url: `${server.base}/model` });
      expect(file).toBe(target);
      expect(readFileSync(target, "utf8")).toBe("the model bytes");
      expect(readdirSync(path.dirname(target))).toEqual(["ggml-base.en.bin"]);
    } finally {
      server.close();
    }
  });

  it("stops curl when cancelled and leaves no partial file", async () => {
    const server = await startServer();
    try {
      const controller = new AbortController();
      const pending = ensureModel({
        target,
        url: `${server.base}/stall`,
        signal: controller.signal,
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      controller.abort();
      await expect(pending).rejects.toThrow();
      expect(readdirSync(path.dirname(target))).toEqual([]);
    } finally {
      server.close();
    }
  });

  it("uses the file it already has", async () => {
    const { download, calls } = controlledDownload();
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, "model");
    expect(await ensureModel({ target, download })).toBe(target);
    expect(calls).toHaveLength(0);
  });

  it("gives two callers at once one download", async () => {
    const { download, calls } = controlledDownload();
    const first = ensureModel({ target, download });
    const second = ensureModel({ target, download });
    await tick();
    expect(calls).toHaveLength(1);
    calls[0].finish();
    expect(await first).toBe(target);
    expect(await second).toBe(target);
  });

  it("removes the partial file when the download fails, and tries again next time", async () => {
    const { download, calls } = controlledDownload();
    const first = ensureModel({ target, download });
    await tick();
    calls[0].fail();
    await expect(first).rejects.toThrow("network down");
    expect(existsSync(calls[0].file)).toBe(false);
    expect(existsSync(target)).toBe(false);

    const again = ensureModel({ target, download });
    await tick();
    expect(calls).toHaveLength(2);
    expect(calls[1].file).not.toBe(calls[0].file);
    calls[1].finish();
    expect(await again).toBe(target);
  });

  it("starts its own download when the one it waited on is cancelled", async () => {
    const { download, calls } = controlledDownload();
    const controller = new AbortController();
    const cancelled = ensureModel({ target, download, signal: controller.signal });
    const waiting = ensureModel({ target, download });
    await tick();
    controller.abort();
    await expect(cancelled).rejects.toThrow();
    await tick();
    expect(calls).toHaveLength(2);
    calls[1].finish();
    expect(await waiting).toBe(target);
  });

  it("lets a waiting caller cancel without ending the download", async () => {
    const { download, calls } = controlledDownload();
    const downloading = ensureModel({ target, download });
    const controller = new AbortController();
    const waiting = ensureModel({ target, download, signal: controller.signal });
    await tick();
    controller.abort();
    await expect(waiting).rejects.toThrow();
    calls[0].finish();
    expect(await downloading).toBe(target);
    expect(calls).toHaveLength(1);
  });
});
