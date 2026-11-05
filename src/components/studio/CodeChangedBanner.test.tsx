import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { changedCodeSummary } from "./code-changed-text";
import { CodeChangedNotice } from "./CodeChangedBanner";

const draw = (changed: string[]) => renderToStaticMarkup(<CodeChangedNotice changed={changed} />);

describe("CodeChangedNotice", () => {
  it("renders nothing while the studio runs its source as it is", () => {
    expect(draw([])).toBe("");
  });

  it("says to restart, and names the changed files", () => {
    const html = draw(["server/edit-yaml.mjs", "src/content/watermark-rules.mjs"]);
    expect(html).toContain("Restart the studio");
    expect(html).toContain("server/edit-yaml.mjs, src/content/watermark-rules.mjs");
    expect(html).toContain('role="status"');
  });
});

describe("changedCodeSummary", () => {
  it("names up to three files and counts the rest", () => {
    expect(changedCodeSummary(["a.mjs"])).toBe("a.mjs");
    expect(changedCodeSummary(["a.mjs", "b.mjs", "c.mjs"])).toBe("a.mjs, b.mjs, c.mjs");
    expect(changedCodeSummary(["a.mjs", "b.mjs", "c.mjs", "d.mjs", "e.mjs"])).toBe(
      "a.mjs, b.mjs, c.mjs and 2 more",
    );
  });
});
