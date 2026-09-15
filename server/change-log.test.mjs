import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createChangeLog, editForLog } from "./change-log.mjs";

let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "change-log-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const logFile = () => path.join(dir, ".studio", "changes.jsonl");

describe("createChangeLog", () => {
  it("appends one compact JSON line per entry, starting with at, source, showcaseId, kind", () => {
    const log = createChangeLog(() => dir);
    log.append({ kind: "asset.delete", source: "ui", showcaseId: "nova", name: "shot.png" });
    const text = readFileSync(logFile(), "utf8");
    expect(text).toMatch(
      /^\{"at":"[^"]+","source":"ui","showcaseId":"nova","kind":"asset.delete","name":"shot.png"\}\n$/,
    );
    expect(log.path()).toBe(logFile());
  });

  it("rotates past maxBytes instead of trimming in place, and reads both files", () => {
    const log = createChangeLog(() => dir, { maxBytes: 300 });
    for (let i = 0; i < 8; i++) {
      log.append({ source: "ui", showcaseId: "nova", kind: "asset.delete", name: `shot-${i}.png` });
    }
    expect(existsSync(path.join(dir, ".studio", "changes.1.jsonl"))).toBe(true);
    expect(statSync(logFile()).size).toBeLessThanOrEqual(300);
    const names = log.entries().map((entry) => entry.name);
    expect(names.length).toBeLessThan(8);
    expect(names.at(-1)).toBe("shot-7.png");
    expect(names).toEqual([...names].sort());
  });

  it("skips lines that aren't JSON", () => {
    const log = createChangeLog(() => dir);
    log.append({ source: "ui", showcaseId: "nova", kind: "asset.add", names: ["a.png"] });
    appendFileSync(logFile(), '{"torn": \n');
    log.append({ source: "ui", showcaseId: "nova", kind: "asset.add", names: ["b.png"] });
    expect(log.entries().map((entry) => entry.names[0])).toEqual(["a.png", "b.png"]);
  });

  it("lists what changed since a version, and says when it has no record of it", () => {
    const log = createChangeLog(() => dir);
    const edit = (source, previousVersion, version, showcaseId = "nova") =>
      log.append({
        source,
        showcaseId,
        kind: "edit",
        file: "showcase.yaml",
        previousVersion,
        version,
      });
    edit("mcp", "v0", "v1");
    log.append({ source: "ui", showcaseId: "nova", kind: "asset.add", names: ["a.png"] });
    edit("ui", "v1", "v2", "other");
    edit("ui", "v1", "v2");
    const kinds = (entries) => entries.map((e) => `${e.source}:${e.kind}`);

    const sinceV1 = log.since("nova", "showcase.yaml", "v1");
    expect(sinceV1.known).toBe(true);
    expect(kinds(sinceV1.entries)).toEqual(["ui:asset.add", "ui:edit"]);

    /* v0 was never written by the studio, but the first edit replaced it. */
    const sinceV0 = log.since("nova", "showcase.yaml", "v0");
    expect(kinds(sinceV0.entries)).toEqual(["mcp:edit", "ui:asset.add", "ui:edit"]);

    const unknown = log.since("nova", "showcase.yaml", "hand-edited", { recent: 2 });
    expect(unknown.known).toBe(false);
    expect(kinds(unknown.entries)).toEqual(["ui:asset.add", "ui:edit"]);
  });

  it("never throws when the log can't be written", () => {
    const warnings = [];
    const log = createChangeLog(() => path.join(dir, "missing\0folder"), {
      log: (message) => warnings.push(message),
    });
    expect(() =>
      log.append({ source: "ui", showcaseId: "nova", kind: "asset.delete", name: "x" }),
    ).not.toThrow();
    expect(warnings).toHaveLength(1);
  });
});

describe("editForLog", () => {
  it("puts the page's edits in edit_showcase's shape", () => {
    const base = { showcaseId: "nova", sceneId: "intro", baseHash: "abc" };
    expect(editForLog({ ...base, field: "title", value: "Hi" })).toEqual({
      field: "scene.set",
      sceneId: "intro",
      name: "title",
      value: "Hi",
    });
    expect(editForLog({ ...base, field: "caption", captionIndex: 1, value: "Line" })).toEqual({
      field: "caption.set",
      sceneId: "intro",
      captionIndex: 1,
      name: "text",
      value: "Line",
    });
    expect(
      editForLog({ ...base, sceneId: "", field: "meta.captionStyle", value: "karaoke" }),
    ).toEqual({ field: "meta.set", name: "captionStyle", value: "karaoke" });
    expect(
      editForLog({ ...base, field: "media.asset", value: "hero", mediaKind: undefined }),
    ).toEqual({ field: "media.asset", sceneId: "intro", value: "hero" });
    expect(
      editForLog({
        ...base,
        sceneId: "",
        field: "theme",
        group: "colors",
        name: "caption-text",
        value: "#fff",
      }),
    ).toEqual({ field: "theme", group: "colors", name: "caption-text", value: "#fff" });
  });
});
