import { describe, expect, it } from "vitest";
import {
  exportKindFor,
  exportLabel,
  exportPercent,
  fileManagerName,
  PLAYER_VIEWS,
  playerView,
} from "./export-kinds.mjs";

describe("export kinds", () => {
  it("reads a player view name from the outside, or nothing", () => {
    expect(PLAYER_VIEWS).toEqual(["tiktok", "screens", "embed"]);
    for (const view of PLAYER_VIEWS) expect(playerView(view)).toBe(view);
    /* YAML reads `view: 43` as a number; the player's names are words. */
    expect(playerView(43)).toBeNull();
    expect(playerView("4:3")).toBeNull();
    expect(playerView(undefined)).toBeNull();
  });

  it("picks the export the player's view previews", () => {
    expect(exportKindFor("tiktok", "draft")).toBe("video-draft");
    expect(exportKindFor("tiktok", "full")).toBe("video");
    expect(exportKindFor("embed", "draft")).toBe("video-43-draft");
    expect(exportKindFor("embed", "full")).toBe("video-43");
    expect(exportKindFor("screens", "draft")).toBe("screens");
    expect(exportKindFor("screens", "full")).toBe("screens");
  });

  it("names kinds, progress, and the file manager", () => {
    expect(exportLabel("video-43-draft")).toBe("4:3 draft");
    expect(exportLabel("screens")).toBe("Screenshots");
    expect(exportPercent({ step: 13, steps: 26 })).toBe(50);
    expect(exportPercent({})).toBeNull();
    expect(fileManagerName("MacIntel")).toBe("Finder");
    expect(fileManagerName("darwin")).toBe("Finder");
    expect(fileManagerName("Win32")).toBe("Explorer");
    expect(fileManagerName("Linux x86_64")).toBe("folder");
  });
});
