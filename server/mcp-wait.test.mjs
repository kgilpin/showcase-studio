import { describe, expect, it } from "vitest";
import { callTool, jobStatus, MAX_WAIT_MS, TOOLS } from "./mcp.mjs";

/** A job lane whose job is running for the first `runningFor` looks. */
function lane(runningFor) {
  let looks = 0;
  return {
    looks: () => looks,
    status(id) {
      if (id !== "export-1") return null;
      looks += 1;
      return looks > runningFor
        ? { jobId: id, status: "done", out: "/exports/nova.mp4" }
        : { jobId: id, status: "running", label: `frame ${looks}` };
    },
    cancel: () => null,
  };
}

describe("waiting on a job", () => {
  it("answers at once without waitMs", async () => {
    const jobs = lane(3);
    expect(await jobStatus(jobs, "export-1", undefined)).toMatchObject({ status: "running" });
    expect(jobs.looks()).toBe(1);
  });

  it("looks again until the job is done, then answers", async () => {
    const jobs = lane(3);
    const slept = [];
    let clock = 0;
    const sleep = async (ms) => {
      slept.push(ms);
      clock += ms;
    };
    const status = await jobStatus(jobs, "export-1", 10_000, { sleep, now: () => clock });
    expect(status).toMatchObject({ status: "done", out: "/exports/nova.mp4" });
    expect(jobs.looks()).toBe(4);
    expect(slept).toEqual([500, 500, 500]);
  });

  it("gives up when the wait runs out, and caps the wait", async () => {
    const jobs = lane(1_000_000);
    let clock = 0;
    const sleep = async (ms) => {
      clock += ms;
    };
    const status = await jobStatus(jobs, "export-1", 1_200, { sleep, now: () => clock });
    expect(status).toMatchObject({ status: "running" });
    expect(clock).toBe(1_200);

    clock = 0;
    await jobStatus(jobs, "export-1", MAX_WAIT_MS * 5, { sleep, now: () => clock });
    expect(clock).toBe(MAX_WAIT_MS);
  });

  it("is null for a job that doesn't exist", async () => {
    expect(await jobStatus(lane(0), "nope", 5_000)).toBeNull();
  });

  it("is offered by export_status and build_status, and used by them", async () => {
    for (const name of ["export_status", "build_status"]) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool.inputSchema.properties.waitMs).toBeDefined();
      expect(tool.description).toContain("waitMs");
    }
    const exportJobs = lane(2);
    const context = {
      getShowcasesDir: () => "/nowhere",
      getUrl: () => "http://localhost:1",
      exportJobs,
      buildJobs: lane(0),
    };
    const { content } = await callTool(context, {
      name: "export_status",
      arguments: { jobId: "export-1", waitMs: 5_000 },
    });
    expect(JSON.parse(content[0].text)).toMatchObject({ status: "done" });
    expect(exportJobs.looks()).toBe(3);
  });
});
