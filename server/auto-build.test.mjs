import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createActionsLog } from "./actions-log.mjs";
import { createAutoBuild } from "./auto-build.mjs";
import { createExportJobs } from "./export-jobs.mjs";

/* The automatic build, with a stand-in for the build itself (a job that
 * ends on the next tick, or fails when told) and for the status check
 * (what each showcase says it needs). The Actions list is the real one,
 * in a temp folder, so the records are what the page would see. */

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const settled = async (jobs, jobId) => {
  for (let i = 0; i < 100; i += 1) {
    const job = jobs.status(jobId);
    if (job && job.status !== "running") return job;
    await tick(5);
  }
  throw new Error("the build never ended");
};

let dir;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "auto-build-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A lane whose builds end on the next tick; `fail` makes them fail. */
function fakeLane({ fail = () => null, runs = [], slowMs = 10 } = {}) {
  let autoBuild;
  const jobs = createExportJobs(
    async (kind, showcaseId, options) => {
      runs.push({ kind, showcaseId, by: options.by, why: options.why, force: options.force });
      await tick(slowMs);
      const error = fail(showcaseId);
      if (error) throw new Error(error);
      return { ok: true, built: ["clip-a.mp4"] };
    },
    {
      onChange: (status) => {
        if (status.status !== "running") autoBuild?.jobEnded(status);
      },
      name: "build",
    },
  );
  return { jobs, runs, wire: (built) => (autoBuild = built) };
}

const stale = (...names) => ({
  built: true,
  kind: "recording",
  ok: true,
  stale: names,
  upToDate: names.length === 0,
  print: names.join("|") || "fresh",
});

describe("createAutoBuild", () => {
  it("builds after a quiet period when something is out of date, as the studio", async () => {
    const lane = fakeLane();
    const actions = createActionsLog(() => dir);
    const statuses = { pitch: stale("clip-a.mp4", "durationMs on a") };
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      actions,
      status: (id) => statuses[id],
      delayMs: 20,
    });
    lane.wire(auto);

    auto.noteShowcase("pitch", "edit");
    expect(auto.pending()).toEqual(["pitch"]);
    /* The quiet period is a pending record, with Skip. */
    const pending = actions.list().find((a) => a.state === "pending");
    expect(pending).toMatchObject({
      kind: "build",
      showcaseId: "pitch",
      by: "studio",
      label: "Build media",
      why: "pitch: showcase.yaml changed",
      offers: ["skip"],
    });
    /* Another change moves the due time, and names the newest change. */
    await tick(5);
    auto.noteShowcase("pitch", "asset.add");
    expect(actions.get(pending.id).why).toBe("pitch: assets changed");
    expect(actions.list().filter((a) => a.state === "pending")).toHaveLength(1);

    await tick(40);
    expect(lane.runs).toHaveLength(1);
    expect(lane.runs[0]).toMatchObject({
      kind: "build",
      showcaseId: "pitch",
      by: "studio",
      why: "pitch changed — 2 things out of date: clip-a.mp4, durationMs on a",
    });
    /* The pending record gave way to the job's own. */
    expect(actions.get(pending.id)).toBeUndefined();
    const job = await settled(lane.jobs, lane.runs.length && lane.jobs.current().jobId);
    expect(job.status).toBe("done");
    expect(auto.pending()).toEqual([]);
  });

  it("does nothing for a showcase that is up to date, or that derives nothing", async () => {
    const lane = fakeLane();
    const actions = createActionsLog(() => dir);
    const statuses = { fresh: stale(), plain: { built: false } };
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      actions,
      status: (id) => statuses[id],
      delayMs: 10,
    });
    lane.wire(auto);
    auto.noteShowcase("fresh", "edit");
    auto.noteChange("plain/showcase.yaml");
    /* Only the showcase that derives media gets a quiet period. */
    expect(auto.pending()).toEqual(["fresh"]);
    expect(actions.list().filter((a) => a.state === "pending")).toHaveLength(1);
    await tick(30);
    expect(lane.runs).toEqual([]);
    /* Both records were dropped, not failed. */
    expect(actions.list()).toEqual([]);
  });

  it("ignores what isn't a change to the inputs, and the switch turned off", async () => {
    const lane = fakeLane();
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      status: () => stale("x"),
      delayMs: 10,
    });
    lane.wire(auto);
    auto.noteShowcase("pitch", "build");
    auto.noteShowcase("pitch", "commit");
    auto.noteShowcase(null, "setting");
    auto.noteChange(".studio/changes.jsonl");
    auto.noteChange("README.md");
    expect(auto.pending()).toEqual([]);

    let on = false;
    const off = createAutoBuild({
      buildJobs: lane.jobs,
      status: () => stale("x"),
      enabled: () => on,
      delayMs: 10,
    });
    off.noteShowcase("pitch", "edit");
    expect(off.pending()).toEqual([]);
    on = true;
    off.noteShowcase("pitch", "edit");
    expect(off.pending()).toEqual(["pitch"]);
    on = false;
    off.cancelPending();
    expect(off.pending()).toEqual([]);
    await tick(20);
    expect(lane.runs).toEqual([]);
  });

  it("reports a cut list that doesn't read once, and not again until it changes", async () => {
    const lane = fakeLane();
    const actions = createActionsLog(() => dir);
    let problem = "every scene needs a take once meta.source is set — these have none: outro";
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      actions,
      status: () => ({ built: true, kind: "recording", ok: false, problem }),
      delayMs: 10,
    });
    lane.wire(auto);
    auto.noteShowcase("pitch", "edit");
    await tick(25);
    const failed = actions.list().filter((a) => a.state === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      error: problem,
      why: "pitch changed, but its media can't be built yet",
    });
    expect(failed[0].offers).toContain("retry");
    expect(lane.runs).toEqual([]);

    /* The same problem again: no second record. */
    auto.noteShowcase("pitch", "edit");
    await tick(25);
    expect(actions.list().filter((a) => a.state === "failed")).toHaveLength(1);
    expect(actions.list().filter((a) => a.state === "pending")).toHaveLength(0);

    /* A different problem is news. */
    problem = 'The recording "take.mp4" is not in pitch/assets';
    auto.noteShowcase("pitch", "edit");
    await tick(25);
    expect(actions.list().filter((a) => a.state === "failed")).toHaveLength(2);
  });

  it("lets a running build finish and goes again after it", async () => {
    const lane = fakeLane({ slowMs: 60 });
    const actions = createActionsLog(() => dir);
    let print = "one";
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      actions,
      status: () => ({ ...stale("clip-a.mp4"), print }),
      delayMs: 10,
    });
    lane.wire(auto);
    /* A build someone started by hand. */
    const first = lane.jobs.start("build", "pitch", { by: "user" });
    auto.noteShowcase("pitch", "edit");
    await tick(25);
    /* The quiet period ended while the build ran: nothing more started. */
    expect(lane.runs).toHaveLength(1);
    expect(auto.pending()).toEqual([]);
    await settled(lane.jobs, first.jobId);
    /* After it, the change that waited gets its own quiet period. */
    print = "two";
    expect(auto.pending()).toEqual(["pitch"]);
    await tick(25);
    expect(lane.runs).toHaveLength(2);
    expect(lane.runs[1].why).toBe("pitch changed — 1 thing out of date: clip-a.mp4");
  });

  it("after its own build fails, waits for the inputs to change before trying again", async () => {
    const runs = [];
    const lane = fakeLane({ fail: () => "aws isn't signed in", runs });
    const actions = createActionsLog(() => dir);
    let print = "one";
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      actions,
      status: () => ({ ...stale("voiceover.m4a"), kind: "voiceover", print }),
      delayMs: 10,
    });
    lane.wire(auto);
    auto.noteShowcase("talk", "edit");
    await tick(25);
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe("voiceover");
    await settled(lane.jobs, lane.jobs.current().jobId);
    /* The same inputs again: the failed job's record says why already. */
    auto.noteShowcase("talk", "edit");
    await tick(25);
    expect(runs).toHaveLength(1);
    /* Changed inputs: tried again. */
    print = "two";
    auto.noteShowcase("talk", "edit");
    await tick(25);
    expect(runs).toHaveLength(2);
  });

  it("ensureBuilt builds first and waits, or does nothing when nothing is stale", async () => {
    const lane = fakeLane();
    const statuses = { pitch: stale("clip-a.mp4"), fresh: stale(), plain: { built: false } };
    const auto = createAutoBuild({
      buildJobs: lane.jobs,
      status: (id) => statuses[id],
      delayMs: 10,
    });
    lane.wire(auto);
    const labels = [];
    const built = await auto.ensureBuilt("pitch", {
      by: "claude",
      onProgress: (label) => labels.push(label),
    });
    expect(built.built).toBe(true);
    expect(built.job.status).toBe("done");
    expect(labels).toEqual(["building the media first"]);
    expect(lane.runs[0]).toMatchObject({
      by: "claude",
      why: "pitch's media was out of date — 1 thing out of date: clip-a.mp4",
    });
    expect(await auto.ensureBuilt("fresh")).toMatchObject({ built: false });
    expect(await auto.ensureBuilt("plain")).toMatchObject({ built: false });

    const failing = fakeLane({ fail: () => "no ffmpeg" });
    const strict = createAutoBuild({
      buildJobs: failing.jobs,
      status: () => stale("x"),
      delayMs: 10,
    });
    failing.wire(strict);
    await expect(strict.ensureBuilt("pitch")).rejects.toThrow("The media build failed: no ffmpeg");
  });
});
