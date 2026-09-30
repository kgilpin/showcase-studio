import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createExportRecords,
  exportFingerprint,
  readRecordFiles,
  showcaseDurationMs,
  writeRecordFile,
} from "./export-records.mjs";
import { moveIntoPlace } from "./export-output.mjs";

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const YAML = `meta:
  title: Nova
scenes:
  - id: intro
    theme: statement
    captions:
      - text: Hi there.
    durationMs: 4000
  - id: two
    theme: statement
    durationMs: 2500
`;

function library() {
  const dir = tempDir("records-library-");
  mkdirSync(path.join(dir, "nova", "assets"), { recursive: true });
  writeFileSync(path.join(dir, "nova", "showcase.yaml"), YAML);
  writeFileSync(path.join(dir, "nova", "assets", "shot.png"), "png");
  return dir;
}

/** A finished export, as the exporter leaves it. */
function exported(dir, name = "nova.mp4", content = "video") {
  mkdirSync(dir, { recursive: true });
  const partial = path.join(dir, `.${name}.partial`);
  writeFileSync(partial, content);
  return moveIntoPlace(partial, path.join(dir, name));
}

describe("exportFingerprint", () => {
  it("ignores the publish block and comments, but not the scenes", () => {
    const dir = library();
    const yaml = path.join(dir, "nova", "showcase.yaml");
    const before = exportFingerprint(dir, "nova", { appVersion: "1" });
    writeFileSync(yaml, `# a comment\n${YAML}publish:\n  caption: Hello\n`);
    expect(exportFingerprint(dir, "nova", { appVersion: "1" })).toBe(before);
    writeFileSync(yaml, YAML.replace("Hi there.", "Hello there."));
    expect(exportFingerprint(dir, "nova", { appVersion: "1" })).not.toBe(before);
  });

  it("changes with an asset, a theme it extends, and the app version", () => {
    const dir = library();
    const print = () => exportFingerprint(dir, "nova", { appVersion: "1" });
    const first = print();
    writeFileSync(path.join(dir, "nova", "assets", "shot.png"), "a new png");
    const second = print();
    expect(second).not.toBe(first);

    mkdirSync(path.join(dir, "base"));
    writeFileSync(path.join(dir, "base", "theme.yaml"), "colors:\n  primary: red\n");
    writeFileSync(path.join(dir, "nova", "theme.yaml"), "extends: base\n");
    const third = print();
    writeFileSync(path.join(dir, "base", "theme.yaml"), "colors:\n  primary: blue\n");
    expect(print()).not.toBe(third);
    expect(exportFingerprint(dir, "nova", { appVersion: "2" })).not.toBe(print());
  });
});

describe("export records", () => {
  it("records an export, and knows when it stops matching the showcase", () => {
    const dir = library();
    const exportsDir = tempDir("records-exports-");
    const records = createExportRecords({ getLibrary: () => dir, appVersion: "1" });
    const file = exported(exportsDir);
    const added = records.add({
      showcaseId: "nova",
      kind: "video",
      file,
      fingerprint: records.fingerprint("nova"),
      durationMs: showcaseDurationMs(dir, "nova"),
      now: new Date("2026-09-30T12:00:00Z"),
    });
    expect(added).toMatchObject({ kind: "video", bytes: 5, durationMs: 6500, appVersion: "1" });
    expect(readdirSync(path.join(dir, ".studio", "exports", "nova"))).toEqual([`${added.id}.json`]);
    expect(records.list("nova")).toEqual([{ ...added, current: true }]);
    expect(records.get("nova", added.id)).toMatchObject({ id: added.id });

    writeFileSync(path.join(dir, "nova", "showcase.yaml"), YAML.replace("4000", "5000"));
    expect(records.list("nova")[0].current).toBe(false);
  });

  it("follows a video the next export moved to a numbered name", () => {
    const dir = library();
    const exportsDir = tempDir("records-exports-");
    const records = createExportRecords({ getLibrary: () => dir, appVersion: "1" });
    const file = exported(exportsDir, "nova.mp4", "first");
    utimesSync(file, new Date("2026-01-01"), new Date("2026-01-01"));
    const first = records.add({
      showcaseId: "nova",
      kind: "video",
      file,
      fingerprint: "old",
      durationMs: 1,
    });
    exported(exportsDir, "nova.mp4", "second, longer");
    const [found] = records.list("nova");
    expect(found.id).toBe(first.id);
    expect(found.file).toBe(path.join(exportsDir, "history", "nova.1.mp4"));
  });

  it("drops a record whose video is gone", () => {
    const dir = library();
    const exportsDir = tempDir("records-exports-");
    const records = createExportRecords({ getLibrary: () => dir, appVersion: "1" });
    const file = exported(exportsDir);
    const added = records.add({
      showcaseId: "nova",
      kind: "video",
      file,
      fingerprint: "x",
      durationMs: 1,
    });
    rmSync(file);
    expect(records.list("nova")).toEqual([]);
    expect(existsSync(path.join(dir, ".studio", "exports", "nova", `${added.id}.json`))).toBe(
      false,
    );
  });

  it("refuses ids that could leave the records folder", () => {
    const records = createExportRecords({ getLibrary: () => library(), appVersion: "1" });
    expect(records.list("../nova")).toEqual([]);
    expect(records.get("nova", "../x")).toBeUndefined();
  });
});

describe("record files", () => {
  it("are written whole, and read back newest first, skipping anything broken", () => {
    const dir = tempDir("records-files-");
    writeRecordFile(path.join(dir, "a.json"), { createdAt: "2026-01-01" });
    writeRecordFile(path.join(dir, "b.json"), { createdAt: "2026-02-01" });
    writeFileSync(path.join(dir, "broken.json"), "{");
    writeFileSync(path.join(dir, ".a.json.1234.tmp"), "{}");
    expect(readRecordFiles(dir).map((r) => r._path)).toEqual(["b.json", "a.json"]);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([".a.json.1234.tmp"]);
    expect(readRecordFiles(path.join(dir, "missing"))).toEqual([]);
  });
});
