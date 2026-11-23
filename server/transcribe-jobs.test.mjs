import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, TRANSCRIBE_WAIT_MS } from "./mcp.mjs";
import { createTranscribeJobs } from "./transcribe-jobs.mjs";
import { transcribe } from "./transcribe.mjs";

let library;
let recording;
beforeEach(() => {
  library = mkdtempSync(path.join(tmpdir(), "transcribe-jobs-"));
  mkdirSync(path.join(library, "pitch", "assets"), { recursive: true });
  recording = path.join(library, "pitch", "assets", "take.wav");
  writeFileSync(recording, "");
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(library, { recursive: true, force: true });
});

/** A studio whose whisper takes `takesMs`, or fails with `error`. */
function studio({ takesMs = 0, error } = {}) {
  const runs = [];
  const logged = [];
  const transcribeJobs = createTranscribeJobs({
    getShowcasesDir: () => library,
    changeLog: { append: (entry) => logged.push(entry) },
    transcribe: (file, { save, signal }) =>
      new Promise((resolve, reject) => {
        runs.push({ file, save, signal });
        const timer = setTimeout(() => {
          if (error) return reject(new Error(error));
          const saved = file.replace(".wav", ".transcript.json");
          resolve({
            text: "hello",
            segments: [],
            ...(save ? { transcript: { file: saved } } : {}),
          });
        }, takesMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(signal.reason);
        });
      }),
  });
  const context = { getShowcasesDir: () => library, transcribeJobs };
  const call = async (name, args) =>
    JSON.parse((await callTool(context, { name, arguments: args })).content[0].text);
  return { call, runs, logged, transcribeJobs };
}

const TAKE = { showcaseId: "pitch", asset: "take", save: true };

describe("transcribing", () => {
  it("returns a short recording's transcript in the one call", async () => {
    const { call } = studio();
    expect(await call("transcribe", TAKE)).toMatchObject({
      status: "done",
      file: recording,
      text: "hello",
    });
  });

  it("outlasts five minutes: a jobId first, then the transcript", async () => {
    vi.useFakeTimers();
    const { call, logged } = studio({ takesMs: 20 * 60_000 });

    const first = call("transcribe", TAKE);
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_WAIT_MS);
    const started = await first;
    expect(started).toMatchObject({ status: "running", file: recording });
    expect(started.next).toContain("transcribe_status");

    await vi.advanceTimersByTimeAsync(6 * 60_000);
    expect(await call("transcribe_status", { jobId: started.jobId })).toMatchObject({
      status: "running",
    });

    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(await call("transcribe_status", { jobId: started.jobId })).toMatchObject({
      status: "done",
      text: "hello",
    });
    /* Logged when written, so the history commits it. */
    expect(logged).toEqual([
      {
        source: "mcp",
        tool: "transcribe",
        showcaseId: "pitch",
        kind: "transcript",
        file: "assets/take.transcript.json",
      },
    ]);
  });

  it("joins the job already running, and runs other recordings beside it", () => {
    const { runs, transcribeJobs } = studio({ takesMs: 60_000 });
    const first = transcribeJobs.start({ file: recording, save: true });
    expect(transcribeJobs.start({ file: recording, save: true }).jobId).toBe(first.jobId);
    const other = transcribeJobs.start({ file: path.join(library, "other.wav") });
    expect(other.jobId).not.toBe(first.jobId);
    expect(runs).toHaveLength(2);
    transcribeJobs.close();
  });

  it("stops the work on cancel and logs nothing", async () => {
    const { call, runs, logged, transcribeJobs } = studio({ takesMs: 60_000 });
    const { jobId } = transcribeJobs.start({ file: recording, save: true });
    expect(await call("transcribe_cancel", { jobId })).toMatchObject({ status: "canceled" });
    expect(runs[0].signal.aborted).toBe(true);
    expect(logged).toEqual([]);
  });

  it("stops every job when the studio closes", () => {
    const { runs, transcribeJobs } = studio({ takesMs: 60_000 });
    transcribeJobs.start({ file: recording });
    transcribeJobs.start({ file: path.join(library, "other.wav") });
    transcribeJobs.close();
    expect(runs.map((run) => run.signal.aborted)).toEqual([true, true]);
  });

  it("passes whisper's failure on, and says when a job is unknown", async () => {
    const { call } = studio({ error: "whisper-cli exited 1" });
    await expect(call("transcribe", TAKE)).rejects.toThrow("whisper-cli exited 1");
    await expect(call("transcribe_status", { jobId: "nope" })).rejects.toThrow("No transcribe job");
  });

  /* A shell script stands in for whisper, so not on Windows. */
  it.skipIf(process.platform === "win32")(
    "kills whisper itself when canceled, and saves nothing",
    async () => {
      const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
      spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=duration=1", recording]);
      const pidFile = path.join(library, "pid");
      const whisper = path.join(library, "whisper-cli");
      writeFileSync(whisper, `#!/bin/sh\necho $$ > "${pidFile}"\nexec sleep 30\n`);
      chmodSync(whisper, 0o755);

      const controller = new AbortController();
      const work = transcribe(recording, {
        save: true,
        signal: controller.signal,
        whisper,
        model: "unused",
      });
      const ended = expect(work).rejects.toThrow(/abort/i);
      await vi.waitFor(() => expect(readFileSync(pidFile, "utf8")).toMatch(/\d+\n/), {
        timeout: 10_000,
      });
      const pid = Number(readFileSync(pidFile, "utf8"));
      controller.abort();
      await ended;

      expect(() => process.kill(pid, 0)).toThrow();
      expect(existsSync(recording.replace(".wav", ".transcript.json"))).toBe(false);
    },
    15_000,
  );
});
