import { describe, expect, it } from "vitest";
import { createExportJobs } from "./export-jobs.mjs";

/** A runner the test finishes by hand. */
function manualRunner() {
  const runs = [];
  const runner = (kind, showcaseId, context) =>
    new Promise((resolve, reject) => runs.push({ kind, showcaseId, ...context, resolve, reject }));
  return { runner, runs };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("export jobs", () => {
  it("reports each step, one job at a time, and remembers the newest", async () => {
    const { runner, runs } = manualRunner();
    const changes = [];
    const jobs = createExportJobs(runner, { onChange: (status) => changes.push(status) });
    expect(jobs.current()).toBeUndefined();

    const started = jobs.start("video-43-draft", "nova");
    expect(started).toMatchObject({ jobId: "export-1", status: "running", progress: "starting" });
    expect(() => jobs.start("screens", "nova")).toThrow("export-1 (video-43-draft of nova)");

    runs[0].onProgress("frame 13/26 (1s)", { step: 13, steps: 26 });
    expect(jobs.current()).toMatchObject({ jobId: "export-1", step: 13, steps: 26 });

    runs[0].resolve("/out/nova_43_draft.mp4");
    await settle();
    expect(jobs.current()).toMatchObject({ status: "done", out: "/out/nova_43_draft.mp4" });
    expect(changes.map((c) => c.status)).toEqual(["running", "running", "done"]);

    jobs.start("screens", "nova");
    expect(jobs.current()).toMatchObject({ jobId: "export-2", status: "running" });
  });

  it("marks a cancel at once and ignores the runner's late failure", async () => {
    const { runner, runs } = manualRunner();
    const changes = [];
    const jobs = createExportJobs(runner, { onChange: (status) => changes.push(status) });
    const { jobId } = jobs.start("video", "nova");
    expect(jobs.cancel(jobId)).toMatchObject({ status: "canceled" });
    expect(runs[0].signal.aborted).toBe(true);
    runs[0].onProgress("frame 31/60 (1s)", { step: 31, steps: 60 });
    runs[0].reject(new Error("Export canceled"));
    await settle();
    expect(jobs.status(jobId)).toMatchObject({ status: "canceled" });
    expect(changes.map((c) => c.status)).toEqual(["running", "canceled"]);
  });

  it("reports a failure with its error", async () => {
    const { runner, runs } = manualRunner();
    const jobs = createExportJobs(runner);
    const { jobId } = jobs.start("video", "nova");
    runs[0].reject(new Error("ffmpeg exited 1"));
    await settle();
    expect(jobs.status(jobId)).toMatchObject({ status: "failed", error: "ffmpeg exited 1" });
  });
});
