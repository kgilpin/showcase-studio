import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioExportJob } from "@/lib/studio";
import { ActivityPill, activeJob } from "./StudioActivity";

const exporting: StudioExportJob = {
  jobId: "export-1",
  kind: "video-43",
  showcaseId: "berlin",
  status: "running",
  progress: "frame 13/26 (1s)",
  step: 13,
  steps: 26,
};

const building: StudioExportJob = {
  jobId: "build-1",
  kind: "build",
  showcaseId: "berlin",
  status: "running",
  progress: "clip-tinder.mp4 (3/8) — 10.40s",
};

const draw = (job: StudioExportJob, kind: "export" | "build", showcaseId = "berlin") =>
  renderToStaticMarkup(
    <ActivityPill job={job} kind={kind} showcaseId={showcaseId} onCancel={() => {}} />,
  );

describe("activeJob", () => {
  it("is nothing while nothing runs", () => {
    expect(activeJob(null, null)).toBeNull();
    expect(
      activeJob({ ...exporting, status: "done" }, { ...building, status: "failed" }),
    ).toBeNull();
  });

  it("shows the running export, else the running build", () => {
    expect(activeJob(exporting, null)).toEqual({ job: exporting, kind: "export" });
    expect(activeJob(null, building)).toEqual({ job: building, kind: "build" });
    expect(activeJob({ ...exporting, status: "done" }, building)).toEqual({
      job: building,
      kind: "build",
    });
  });

  it("gives the slot to the export when both run", () => {
    expect(activeJob(exporting, building)?.kind).toBe("export");
  });
});

describe("ActivityPill", () => {
  it("shows an export's percentage, with a cancel", () => {
    const html = draw(exporting, "export");
    expect(html).toContain('role="status"');
    expect(html).toContain("50%");
    expect(html).toContain("4:3 video ·");
    expect(html).toContain('aria-label="Cancel the export"');
    expect(html).toContain('aria-label="Exporting 4:3 video of berlin, 50%"');
  });

  it("shows the builder's own step, with a cancel", () => {
    const html = draw(building, "build");
    expect(html).toContain('role="status"');
    expect(html).toContain("clip-tinder.mp4 (3/8)");
    expect(html).toContain("Building ·");
    expect(html).toContain('aria-label="Cancel the build"');
    expect(html).toContain('aria-label="Building berlin, clip-tinder.mp4 (3/8) — 10.40s"');
  });

  it("names the showcase when the job is for another one", () => {
    expect(draw(exporting, "export", "paris")).toContain("berlin: 4:3 video ·");
    expect(draw(building, "build", "paris")).toContain("berlin: Building ·");
    expect(draw(exporting, "export")).not.toContain("berlin: ");
  });

  it("draws no progress bar while there is nothing to count", () => {
    const { step: _step, steps: _steps, ...starting } = exporting;
    const html = draw(starting, "export");
    expect(html).toContain("frame 13/26 (1s)");
    expect(html).not.toContain("bg-primary transition-[width]");
  });
});
