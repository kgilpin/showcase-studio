import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSnapshots,
  isSnapshotId,
  snapshotDir,
  snapshotId,
  takeSnapshot,
} from "./export-snapshot.mjs";
import { exportFingerprint } from "./export-records.mjs";
import { handleShowcaseRequest } from "./showcase-data.mjs";

/* The copy of a showcase an export renders from (issue #29): what it
 * holds, that a later write to the library leaves it alone, and that a
 * studio clears only the snapshots of studios that are gone. */

let library;
const write = (p, content) => {
  mkdirSync(path.dirname(path.join(library, p)), { recursive: true });
  writeFileSync(path.join(library, p), content);
};
const read = (p) => readFileSync(path.join(library, p), "utf8");

function libraryWithNova() {
  library = mkdtempSync(path.join(tmpdir(), "export-snapshot-"));
  write("nova/showcase.yaml", "meta:\n  title: Nova\nscenes:\n  - id: intro\n    title: Hello\n");
  write("nova/theme.yaml", "extends: house\ncolors:\n  primary: '#fff'\n");
  write("nova/assets/clip-intro.mp4", "take one");
  write("nova/assets/voiceover.words.json", "[]");
  write("nova/assets/.DS_Store", "junk");
  write("nova/graphics/chart.tsx", "export default () => null;");
  write("house/showcase.yaml", "meta:\n  title: House\nscenes: []\n");
  write("house/theme.yaml", "fonts:\n  body: Inter\n");
  write("house/assets/big.mp4", "not copied");
  return library;
}

afterEach(() => {
  if (library) rmSync(library, { recursive: true, force: true });
});

describe("an export's snapshot of a showcase", () => {
  it("is a one-showcase library the data route serves, with the theme chain's text", async () => {
    libraryWithNova();
    const snapshot = takeSnapshot(library, "nova", snapshotId("export-1", 4242));
    expect(snapshot.id).toBe("4242-export-1");
    expect(snapshot.dir).toBe(path.join(library, ".studio", "snapshots", "4242-export-1"));
    expect(snapshotDir(library, "4242-export-1")).toBe(snapshot.dir);

    const index = JSON.parse((await handleShowcaseRequest(snapshot.dir, "/index.json")).body);
    expect(index.showcases.map((s) => s.id)).toEqual(["house", "nova"]);
    expect(index.showcases[1]).toMatchObject({
      hasTheme: true,
      assets: ["clip-intro.mp4", "voiceover.words.json"],
      graphics: ["chart.tsx"],
    });
    /* The extended showcase is there for its theme only. */
    expect(index.showcases[0]).toMatchObject({ hasTheme: true, assets: [], graphics: [] });
    expect(existsSync(path.join(snapshot.dir, "house", "assets"))).toBe(false);

    snapshot.remove();
    expect(existsSync(snapshot.dir)).toBe(false);
    expect(snapshotDir(library, "4242-export-1")).toBeUndefined();
  });

  it("keeps what it copied when the library changes, in place or by rename", () => {
    libraryWithNova();
    const snapshot = takeSnapshot(library, "nova", snapshotId("export-2"));
    const copyOf = (p) => readFileSync(path.join(snapshot.dir, p), "utf8");
    /* showcase.yaml and the words file are written in place (a pin, a
     * re-transcribe); a clip is written beside and renamed into place. */
    write("nova/showcase.yaml", "meta:\n  title: Nova, cut again\nscenes: []\n");
    write("nova/assets/voiceover.words.json", '[{"word":"hi"}]');
    write("nova/assets/clip-intro.partial.mp4", "take two");
    renameSync(
      path.join(library, "nova/assets/clip-intro.partial.mp4"),
      path.join(library, "nova/assets/clip-intro.mp4"),
    );
    expect(read("nova/showcase.yaml")).toContain("cut again");
    expect(copyOf("nova/showcase.yaml")).toBe(
      "meta:\n  title: Nova\nscenes:\n  - id: intro\n    title: Hello\n",
    );
    expect(copyOf("nova/assets/voiceover.words.json")).toBe("[]");
    expect(copyOf("nova/assets/clip-intro.mp4")).toBe("take one");
    snapshot.remove();
  });

  it("has the library's fingerprint, so a finished export reads as up to date", () => {
    libraryWithNova();
    /* Files made a while ago: a copy stamped "now" would differ. */
    const then = new Date("2026-01-01T00:00:00Z");
    for (const p of ["nova/assets/clip-intro.mp4", "nova/graphics/chart.tsx"]) {
      utimesSync(path.join(library, p), then, then);
    }
    const snapshot = takeSnapshot(library, "nova", snapshotId("export-1", 4242));
    expect(exportFingerprint(snapshot.dir, "nova", { appVersion: "1.0.0" })).toBe(
      exportFingerprint(library, "nova", { appVersion: "1.0.0" }),
    );
  });

  it("refuses what isn't a showcase or a snapshot id", () => {
    libraryWithNova();
    expect(() => takeSnapshot(library, "ghost", snapshotId("export-3"))).toThrow(
      'No showcase named "ghost" in the library',
    );
    expect(() => takeSnapshot(library, "nova", "../escape")).toThrow(
      'Not a snapshot id: "../escape"',
    );
    expect(isSnapshotId("123-export-4")).toBe(true);
    expect(isSnapshotId("export-4")).toBe(false);
    expect(isSnapshotId("1-a/b")).toBe(false);
    expect(snapshotId("export 5", 7)).toBe("7-export_5");
    expect(snapshotDir(library, "../nova")).toBeUndefined();
  });

  it("clears the snapshots of studios that are gone, and keeps a running studio's", () => {
    libraryWithNova();
    takeSnapshot(library, "nova", snapshotId("export-1", 111));
    takeSnapshot(library, "nova", snapshotId("export-1", 222));
    takeSnapshot(library, "nova", snapshotId("export-9"));
    write(".studio/snapshots/notes.txt", "a loose file stays");
    const removed = clearSnapshots(library, { isRunning: (pid) => pid === 222 });
    expect(removed.sort()).toEqual([`${process.pid}-export-9`, "111-export-1"].sort());
    expect(snapshotDir(library, "222-export-1")).toBeDefined();
    expect(existsSync(path.join(library, ".studio", "snapshots", "notes.txt"))).toBe(true);
    expect(clearSnapshots(path.join(library, "nowhere"))).toEqual([]);
  });
});
