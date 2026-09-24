import { describe, expect, it } from "vitest";
import { DOCK_WIDTH, dockWidth } from "./dock-width";

/* The panel is hidden in more cases than it is docked, and a width asked
 * for while it renders nothing leaves an empty 640px gap down the side of
 * the page — which is what the studio Claude Code starts always does,
 * since it turns terminals off. */
describe("the room the agent panel asks for", () => {
  const shown = { available: true, open: true, showcaseId: "nova", capturing: false };

  it("asks for room only when the panel is really on screen", () => {
    expect(dockWidth(shown)).toBe(DOCK_WIDTH);
  });

  it("asks for none in every case the panel renders nothing", () => {
    expect(dockWidth({ ...shown, available: false })).toBe(0);
    expect(dockWidth({ ...shown, open: false })).toBe(0);
    expect(dockWidth({ ...shown, showcaseId: undefined })).toBe(0);
    expect(dockWidth({ ...shown, capturing: true })).toBe(0);
  });
});
