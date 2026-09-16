import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { moveIntoPlace, partialPath, revealCommand } from "./export-output.mjs";

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

function outDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "export-output-"));
  dirs.push(dir);
  return dir;
}

/** Writes `text` under the partial name and moves it into place. */
function finish(dir, name, text) {
  const final = path.join(dir, name);
  const partial = partialPath(final);
  writeFileSync(partial, text);
  return moveIntoPlace(partial, final);
}

const read = (dir, name) => readFileSync(path.join(dir, name), "utf8");

describe("moving a finished export into place", () => {
  it("keeps older exports numbered, newest at the plain name", () => {
    const dir = outDir();
    finish(dir, "nova_draft.mp4", "first");
    finish(dir, "nova_draft.mp4", "second");
    finish(dir, "nova_draft.mp4", "third");
    expect(readdirSync(dir).sort()).toEqual([
      "nova_draft.1.mp4",
      "nova_draft.2.mp4",
      "nova_draft.mp4",
    ]);
    expect(read(dir, "nova_draft.mp4")).toBe("third");
    expect(read(dir, "nova_draft.1.mp4")).toBe("second");
    expect(read(dir, "nova_draft.2.mp4")).toBe("first");
  });

  it("leaves other exports' numbers alone", () => {
    const dir = outDir();
    finish(dir, "nova.mp4", "full");
    finish(dir, "nova_draft.mp4", "draft 1");
    finish(dir, "nova_draft.mp4", "draft 2");
    finish(dir, "nova.mp4", "full 2");
    expect(readdirSync(dir).sort()).toEqual([
      "nova.1.mp4",
      "nova.mp4",
      "nova_draft.1.mp4",
      "nova_draft.mp4",
    ]);
    expect(read(dir, "nova.1.mp4")).toBe("full");
  });

  it("keeps gaps in the numbering without overwriting", () => {
    const dir = outDir();
    writeFileSync(path.join(dir, "nova.mp4"), "a");
    writeFileSync(path.join(dir, "nova.3.mp4"), "c");
    finish(dir, "nova.mp4", "new");
    expect(readdirSync(dir).sort()).toEqual(["nova.1.mp4", "nova.4.mp4", "nova.mp4"]);
    expect(read(dir, "nova.1.mp4")).toBe("a");
  });

  it("numbers folders too: screens, screens.1", () => {
    const dir = outDir();
    for (const shot of ["one", "two"]) {
      const final = path.join(dir, "screens");
      const partial = partialPath(final, { isDir: true });
      mkdirSync(partial);
      writeFileSync(path.join(partial, "01-intro.png"), shot);
      moveIntoPlace(partial, final);
    }
    expect(readdirSync(dir).sort()).toEqual(["screens", "screens.1"]);
    expect(read(dir, "screens/01-intro.png")).toBe("two");
    expect(read(dir, "screens.1/01-intro.png")).toBe("one");
  });

  it("writes partials under a hidden name that keeps the extension", () => {
    expect(path.basename(partialPath("/x/nova_43.mp4"))).toBe(".nova_43.partial.mp4");
    expect(path.basename(partialPath("/x/screens", { isDir: true }))).toBe(".screens.partial");
  });
});

describe("revealing an export", () => {
  it("selects a file, or opens a folder, in each platform's file manager", () => {
    expect(revealCommand("/e/nova.mp4", { platform: "darwin" })).toEqual([
      "open",
      ["-R", "/e/nova.mp4"],
    ]);
    expect(revealCommand("/e/screens", { platform: "darwin", isDir: true })).toEqual([
      "open",
      ["/e/screens"],
    ]);
    expect(revealCommand("C:\\e\\nova.mp4", { platform: "win32" })).toEqual([
      "explorer",
      ["/select,C:\\e\\nova.mp4"],
    ]);
    expect(revealCommand("/e/nova.mp4", { platform: "linux" })).toEqual(["xdg-open", ["/e"]]);
  });
});
