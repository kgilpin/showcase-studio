import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isStudioCodeFile, watchStudioCode } from "./code-changes.mjs";

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

/** A checkout with the kinds of files the studio does and doesn't load. */
function checkout() {
  const dir = mkdtempSync(path.join(tmpdir(), "studio-code-"));
  cleanups.push(() =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 }),
  );
  mkdirSync(path.join(dir, "server"), { recursive: true });
  mkdirSync(path.join(dir, "src", "content"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(path.join(dir, "server", "edit-yaml.mjs"), "export const a = 1;\n");
  writeFileSync(path.join(dir, "server", "edit-yaml.test.mjs"), "test\n");
  writeFileSync(path.join(dir, "src", "content", "rules.mjs"), "export const FIELDS = [];\n");
  writeFileSync(path.join(dir, "src", "content", "page.tsx"), "export const Page = 1;\n");
  writeFileSync(path.join(dir, "scripts", "dev.mjs"), "start\n");
  return dir;
}

/** Watches `dir` and records every list `onChange` reports. */
function watching(dir) {
  const reports = [];
  const watcher = watchStudioCode(dir, { onChange: (files) => reports.push(files), settleMs: 50 });
  cleanups.push(() => watcher.close());
  /* Waits until the latest report is `expected`; fs.watch takes a moment
   * to notice a write. */
  const expectReport = async (expected) => {
    const deadline = Date.now() + 5_000;
    while (JSON.stringify(reports.at(-1)) !== JSON.stringify(expected)) {
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(reports.at(-1)).toEqual(expected);
    expect(watcher.changed()).toEqual(expected);
  };
  return { watcher, reports, expectReport };
}

describe("isStudioCodeFile", () => {
  it("is the server's modules, the plain ESM under src/, and the start scripts", () => {
    expect(isStudioCodeFile("server/edit-yaml.mjs")).toBe(true);
    expect(isStudioCodeFile("src/content/watermark-rules.mjs")).toBe(true);
    expect(isStudioCodeFile("src/lib/window-lock.mjs")).toBe(true);
    expect(isStudioCodeFile("scripts/dev.mjs")).toBe(true);
    expect(isStudioCodeFile("scripts/dev-studio.mjs")).toBe(true);
    expect(isStudioCodeFile("server\\edit-yaml.mjs")).toBe(true);
  });

  it("is not a test, a type file, a page file, or another script", () => {
    expect(isStudioCodeFile("server/edit-yaml.test.mjs")).toBe(false);
    expect(isStudioCodeFile("src/content/watermark-rules.d.mts")).toBe(false);
    expect(isStudioCodeFile("src/content/watermark.ts")).toBe(false);
    expect(isStudioCodeFile("src/components/showcase/SceneView.tsx")).toBe(false);
    expect(isStudioCodeFile("scripts/export-video.mjs")).toBe(false);
    expect(isStudioCodeFile("scripts/sub/dev.mjs")).toBe(false);
    expect(isStudioCodeFile("electron/main.mjs")).toBe(false);
    expect(isStudioCodeFile("server")).toBe(false);
  });
});

describe("watchStudioCode", () => {
  it("starts with nothing changed", () => {
    const dir = checkout();
    const { watcher, reports } = watching(dir);
    expect(watcher.changed()).toEqual([]);
    expect(reports).toEqual([]);
  });

  it("reports a changed rule file, sorted with the others, and clears one put back", async () => {
    const dir = checkout();
    const { expectReport } = watching(dir);
    writeFileSync(path.join(dir, "src", "content", "rules.mjs"), 'export const FIELDS = ["x"];\n');
    await expectReport(["src/content/rules.mjs"]);
    writeFileSync(path.join(dir, "server", "edit-yaml.mjs"), "export const a = 2;\n");
    await expectReport(["server/edit-yaml.mjs", "src/content/rules.mjs"]);
    writeFileSync(path.join(dir, "src", "content", "rules.mjs"), "export const FIELDS = [];\n");
    await expectReport(["server/edit-yaml.mjs"]);
    writeFileSync(path.join(dir, "server", "edit-yaml.mjs"), "export const a = 1;\n");
    await expectReport([]);
  });

  it("ignores a save that changes nothing, tests, and page files", async () => {
    const dir = checkout();
    const { watcher, reports } = watching(dir);
    writeFileSync(path.join(dir, "server", "edit-yaml.mjs"), "export const a = 1;\n");
    writeFileSync(path.join(dir, "server", "edit-yaml.test.mjs"), "changed test\n");
    writeFileSync(path.join(dir, "src", "content", "page.tsx"), "export const Page = 2;\n");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(reports).toEqual([]);
    expect(watcher.changed()).toEqual([]);
  });

  it("counts a new module and a deleted one", async () => {
    const dir = checkout();
    const { expectReport } = watching(dir);
    writeFileSync(path.join(dir, "server", "new-thing.mjs"), "export const n = 1;\n");
    await expectReport(["server/new-thing.mjs"]);
    unlinkSync(path.join(dir, "scripts", "dev.mjs"));
    await expectReport(["scripts/dev.mjs", "server/new-thing.mjs"]);
  });

  it("watches only the folders that exist", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "studio-code-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const errors = [];
    const watcher = watchStudioCode(dir, { onError: (message) => errors.push(message) });
    cleanups.push(() => watcher.close());
    expect(watcher.changed()).toEqual([]);
    expect(errors).toEqual([]);
  });
});
