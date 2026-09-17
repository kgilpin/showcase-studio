import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioExportJob } from "@/lib/studio";
import { BuildMediaControl } from "./BuildMediaButton";
import { buildSummary } from "./build-summary";

const running: StudioExportJob = {
  jobId: "build-1",
  kind: "build",
  showcaseId: "berlin",
  status: "running",
  progress: "clip-tinder.mp4 (3/8) — 10.40s",
};

const draw = (job: StudioExportJob | null) =>
  renderToStaticMarkup(<BuildMediaControl job={job} onBuild={() => {}} onCancel={() => {}} />);

describe("BuildMediaControl", () => {
  it("offers the build when nothing is running", () => {
    const html = draw(null);
    expect(html).toContain('aria-label="Build media"');
    expect(html).toContain("Build media");
    expect(html).not.toContain('role="status"');
  });

  it("shows the builder's own step while it runs, with a cancel", () => {
    const html = draw(running);
    expect(html).toContain('role="status"');
    expect(html).toContain("clip-tinder.mp4 (3/8)");
    expect(html).toContain('aria-label="Cancel the build"');
    /* No second way to start one while a build is running. */
    expect(html).not.toContain('aria-label="Build media"');
  });

  it("names the showcase being built, for a screen reader", () => {
    expect(draw(running)).toContain("Building berlin:");
  });

  it("offers the build again once it has finished", () => {
    expect(draw({ ...running, status: "done" })).toContain('aria-label="Build media"');
    expect(draw({ ...running, status: "failed", error: "boom" })).toContain(
      'aria-label="Build media"',
    );
  });
});

describe("buildSummary", () => {
  it("says what was built and what was left alone", () => {
    expect(
      buildSummary({ built: ["a", "b"], unchanged: ["c"], notes: [], totalMs: 43_450, pins: {} }),
    ).toBe("Built 2 files · 1 left alone · 43.5s of showcase");
  });

  it("counts one file as one file", () => {
    expect(buildSummary({ built: ["a"], unchanged: [], notes: [], totalMs: 1000, pins: {} })).toBe(
      "Built 1 file · 1.0s of showcase",
    );
  });

  it("says nothing without a report", () => {
    expect(buildSummary(undefined)).toBeUndefined();
  });
});
