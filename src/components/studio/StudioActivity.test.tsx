import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { StudioAction } from "@/lib/studio";
import { detailLine, slotFor, slotLine, timeAgo } from "./activity-text";
import { ActionsPanel, ActivityPill } from "./StudioActivity";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();

const exporting: StudioAction = {
  id: "export-1",
  kind: "export",
  jobKind: "video-43",
  jobId: "export-1",
  showcaseId: "berlin",
  by: "user",
  why: "Started by you",
  label: "4:3 video",
  state: "running",
  startedAt: at(-5_000),
  progress: "frame 13/26 (1s)",
  step: 13,
  steps: 26,
  offers: ["cancel"],
};

const building: StudioAction = {
  id: "build-1",
  kind: "build",
  jobKind: "build",
  jobId: "build-1",
  showcaseId: "berlin",
  by: "claude",
  why: "Started by Claude",
  label: "Build media",
  state: "running",
  startedAt: at(-2_000),
  progress: "clip-tinder.mp4 (3/8) — 10.40s",
  offers: ["cancel"],
};

const committing: StudioAction = {
  id: "commit-1",
  kind: "commit",
  showcaseId: "berlin",
  by: "studio",
  why: "berlin changed",
  label: "Commit to git",
  state: "pending",
  dueAt: at(4_000),
  offers: ["skip"],
};

const failedBuild: StudioAction = {
  ...building,
  id: "build-0",
  jobId: "build-0",
  state: "failed",
  startedAt: at(-90_000),
  finishedAt: at(-60_000),
  error: "The audio and video spans of scene 4 differ by 0.27 s",
  offers: ["retry", "rebuild", "dismiss"],
};

const doneExport: StudioAction = {
  ...exporting,
  id: "export-0",
  jobId: "export-0",
  state: "done",
  finishedAt: at(-3_000),
  result: "/Users/me/Downloads/showcase-exports/berlin/berlin_43.mp4",
  offers: ["reveal"],
};

const draw = (action: StudioAction, showcaseId = "berlin") =>
  renderToStaticMarkup(
    <ActivityPill action={action} showcaseId={showcaseId} now={NOW} onOffer={() => {}} />,
  );

describe("slotFor", () => {
  it("is nothing when nothing is going on", () => {
    expect(slotFor([], NOW)).toBeNull();
    expect(slotFor([{ ...doneExport, finishedAt: at(-60_000) }], NOW)).toBeNull();
    expect(slotFor([{ ...failedBuild, dismissed: true }], NOW)).toBeNull();
  });

  it("shows a running job first, the export before the build", () => {
    expect(slotFor([committing, building, exporting], NOW)).toBe(exporting);
    expect(slotFor([committing, building], NOW)).toBe(building);
  });

  it("then what is about to run, then a failure, then a fresh result", () => {
    expect(slotFor([failedBuild, committing, doneExport], NOW)).toBe(committing);
    expect(slotFor([failedBuild, doneExport], NOW)).toBe(failedBuild);
    expect(slotFor([doneExport], NOW)).toBe(doneExport);
  });
});

describe("the slot's line", () => {
  it("says what runs and how far along", () => {
    expect(slotLine(exporting, "berlin", NOW)).toBe("4:3 video · 50%");
    expect(slotLine(building, "berlin", NOW)).toBe("Build media · clip-tinder.mp4 (3/8) — 10.40s");
  });

  it("counts down to a pending commit and names a failure", () => {
    expect(slotLine(committing, "berlin", NOW)).toBe("Commit to git · in 4s");
    expect(slotLine(failedBuild, "berlin", NOW)).toBe("Build media failed");
    expect(slotLine(doneExport, "berlin", NOW)).toBe("4:3 video ready");
  });

  it("names the showcase when the record is for another one", () => {
    expect(slotLine(exporting, "paris", NOW)).toBe("berlin: 4:3 video · 50%");
  });
});

describe("detailLine", () => {
  it("describes each state in a line", () => {
    expect(detailLine(committing, NOW)).toBe("berlin changed · in 4s");
    expect(detailLine(exporting, NOW)).toBe("50%");
    expect(detailLine(doneExport, NOW)).toBe("berlin_43.mp4");
    expect(detailLine(failedBuild, NOW)).toContain("differ by 0.27 s");
    expect(detailLine({ ...committing, state: "canceled", offers: [] }, NOW)).toBe(
      "Skipped · berlin changed",
    );
  });

  it("sums up a build and a commit", () => {
    const built: StudioAction = {
      ...building,
      state: "done",
      finishedAt: at(-1000),
      result: {
        built: ["a.mp3", "b.mp4"],
        unchanged: ["c.mp4"],
        notes: ["whisper missing"],
        totalMs: 43500,
        pins: {},
      },
      offers: [],
    };
    expect(detailLine(built, NOW)).toBe(
      "Built 2 files · 1 left alone · 43.5s of showcase\nwhisper missing",
    );
    const committed: StudioAction = {
      ...committing,
      state: "done",
      finishedAt: at(-1000),
      result: { sha: "0123456789abcdef", message: "berlin: edit intro caption 1 text", files: [] },
      offers: [],
    };
    expect(detailLine(committed, NOW)).toBe("0123456 berlin: edit intro caption 1 text");
  });
});

describe("timeAgo", () => {
  it("rounds to what a person would say", () => {
    expect(timeAgo(at(-10_000), NOW)).toBe("just now");
    expect(timeAgo(at(-3 * 60_000), NOW)).toBe("3 min ago");
    expect(timeAgo(at(-2 * 3_600_000), NOW)).toBe("2 h ago");
    expect(timeAgo(undefined, NOW)).toBe("");
  });
});

describe("ActivityPill", () => {
  it("shows an export's percentage; canceling is only offered in the list", () => {
    const html = draw(exporting);
    expect(html).toContain('role="status"');
    expect(html).toContain("50%");
    expect(html).toContain("4:3 video ·");
    expect(html).not.toContain("Cancel");
    expect(html).toContain("bg-primary transition-[width]");
  });

  it("shows the builder's own step, and no progress bar", () => {
    const html = draw(building);
    expect(html).toContain("clip-tinder.mp4 (3/8)");
    expect(html).toContain("Build media ·");
    expect(html).not.toContain("bg-primary transition-[width]");
  });

  it("offers to skip a pending commit", () => {
    const html = draw(committing);
    expect(html).toContain("Commit to git · in 4s");
    expect(html).toContain(">Skip<");
    expect(html).not.toContain("Cancel:");
  });

  it("marks a failure without a quick button: the list has the offers", () => {
    const html = draw(failedBuild);
    expect(html).toContain("Build media failed");
    expect(html).toContain("border-destructive/60");
    expect(html).not.toContain(">Skip<");
    expect(html).not.toContain("Cancel:");
  });
});

describe("ActionsPanel", () => {
  const panel = (actions: StudioAction[], showcaseId = "berlin") =>
    renderToStaticMarkup(
      <ActionsPanel actions={actions} showcaseId={showcaseId} now={NOW} onOffer={() => {}} />,
    );

  it("groups what runs, what needs the user, and what happened", () => {
    const html = panel([doneExport, failedBuild, committing, exporting]);
    expect(html.indexOf("Now")).toBeLessThan(html.indexOf("Needs you"));
    expect(html.indexOf("Needs you")).toBeLessThan(html.indexOf("Earlier"));
    expect(html).toContain("Try again");
    expect(html).toContain("Rebuild everything");
    expect(html).toContain("Dismiss");
    expect(html).toContain("berlin_43.mp4");
    expect(html).toContain("Started by Claude");
    expect(html).not.toContain("(Claude)");
  });

  it("says so when there is nothing", () => {
    expect(panel([])).toContain("Nothing yet");
  });

  it("keeps a dismissed failure in the history, not in Needs you", () => {
    const html = panel([{ ...failedBuild, dismissed: true, offers: [] }]);
    expect(html).not.toContain("Needs you");
    expect(html).toContain("Earlier");
  });
});
