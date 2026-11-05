import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeChangedNotice } from "./CodeChangedBanner";

const draw = (changed: string[]) => renderToStaticMarkup(<CodeChangedNotice changed={changed} />);

describe("CodeChangedNotice", () => {
  it("renders nothing while the studio runs its source as it is", () => {
    expect(draw([])).toBe("");
  });

  it("says to restart, and not which files changed", () => {
    const html = draw(["server/edit-yaml.mjs", "src/content/watermark-rules.mjs"]);
    expect(html).toContain("Restart the studio");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("edit-yaml");
  });
});
