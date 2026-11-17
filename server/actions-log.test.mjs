import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ACTIONS_LOG, createActionsLog, defaultWhy } from "./actions-log.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

function library() {
  const dir = mkdtempSync(path.join(tmpdir(), "studio-actions-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const lines = (dir) =>
  readFileSync(path.join(dir, ACTIONS_LOG), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

/** A clock the test moves. */
function clock(start = Date.parse("2026-11-05T12:00:00Z")) {
  let t = start;
  const now = () => t;
  now.tick = (ms) => (t += ms);
  return now;
}

describe("the Actions list", () => {
  it("records a pending commit in memory only, and writes it once it runs", () => {
    const dir = library();
    const now = clock();
    const changes = [];
    const actions = createActionsLog(() => dir, { now, onChange: (r) => changes.push(r) });
    const skipped = [];
    const record = actions.add(
      {
        kind: "commit",
        showcaseId: "nova",
        by: "studio",
        why: "nova changed",
        label: "Commit to git",
        state: "pending",
        dueAt: new Date(now() + 5000).toISOString(),
      },
      { skip: () => skipped.push("yes"), retry: () => {} },
    );
    expect(record).toMatchObject({ state: "pending", offers: ["skip"], by: "studio" });
    expect(existsSync(path.join(dir, ACTIONS_LOG))).toBe(false);

    now.tick(5000);
    actions.update(record.id, { state: "running" });
    expect(actions.get(record.id)).toMatchObject({
      state: "running",
      startedAt: new Date(now()).toISOString(),
      offers: [],
    });
    actions.update(record.id, {
      state: "done",
      result: { sha: "abc", message: "nova: edit", files: ["showcase.yaml"] },
    });
    expect(lines(dir).map((l) => l.state)).toEqual(["running", "done"]);
    expect(lines(dir)[1]).toMatchObject({ id: record.id, result: { sha: "abc" } });
    expect(changes.map((c) => c.state)).toEqual(["pending", "running", "done"]);
    expect(actions.summary()).toMatchObject({ pending: 0, running: 0, failed: [] });
  });

  it("offers skip while pending, retry and dismiss after a failure", async () => {
    const dir = library();
    const actions = createActionsLog(() => dir, { now: clock() });
    const ran = [];
    const { id } = actions.add(
      { kind: "commit", showcaseId: "nova", by: "studio", label: "Commit to git" },
      { skip: () => ran.push("skip"), retry: () => ran.push("retry") },
    );
    expect(await actions.perform(id, "retry")).toMatchObject({ ok: false });
    expect(await actions.perform(id, "dismiss")).toMatchObject({ ok: false });

    actions.update(id, { state: "running" });
    actions.update(id, { state: "failed", error: "git commit failed: hook said no" });
    expect(actions.get(id).offers).toEqual(["retry", "dismiss"]);
    expect(actions.summary().failed).toEqual([
      {
        id,
        kind: "commit",
        label: "Commit to git",
        showcaseId: "nova",
        by: "studio",
        error: "git commit failed: hook said no",
      },
    ]);

    expect(await actions.perform(id, "retry")).toEqual({ ok: true });
    expect(ran).toEqual(["retry"]);
    expect(await actions.perform(id, "dismiss")).toEqual({ ok: true });
    expect(actions.get(id)).toMatchObject({ dismissed: true, offers: ["retry"] });
    expect(actions.summary().failed).toEqual([]);
    expect(lines(dir).at(-1)).toMatchObject({ state: "failed", dismissed: true });
    expect(await actions.perform("nope", "retry")).toMatchObject({ ok: false });
  });

  it("drops a pending record that had nothing to do, telling the pages", () => {
    const dir = library();
    const changes = [];
    const actions = createActionsLog(() => dir, { onChange: (r) => changes.push(r) });
    const { id } = actions.add({ kind: "commit", showcaseId: "nova", label: "Commit to git" });
    actions.drop(id);
    expect(actions.get(id)).toBeUndefined();
    expect(changes.at(-1)).toMatchObject({ id, state: "dropped" });
    /* A running record can't be dropped: it has been written. */
    const running = actions.add({ kind: "build", showcaseId: "nova", state: "running" });
    actions.drop(running.id);
    expect(actions.get(running.id)).toBeDefined();
  });

  it("follows a job lane: one record per job, kept current, progress never written", () => {
    const dir = library();
    const changes = [];
    const actions = createActionsLog(() => dir, { onChange: (r) => changes.push(r) });
    const canceled = [];
    const follow = (status) =>
      actions.job(status, {
        kind: "export",
        label: "4:3 draft",
        handlers: { cancel: () => canceled.push(status.jobId), retry: () => {}, reveal: () => {} },
      });
    const base = { jobId: "export-1", kind: "video-43-draft", showcaseId: "nova", by: "claude" };
    follow({ ...base, status: "running", progress: "starting" });
    follow({ ...base, status: "running", progress: "frame 3/26", step: 3, steps: 26 });
    follow({ ...base, status: "running", progress: "frame 13/26", step: 13, steps: 26 });
    const [record] = actions.list();
    expect(record).toMatchObject({
      kind: "export",
      jobKind: "video-43-draft",
      jobId: "export-1",
      by: "claude",
      why: "Started by Claude",
      label: "4:3 draft",
      state: "running",
      progress: "frame 13/26",
      step: 13,
      steps: 26,
      offers: ["cancel"],
    });
    expect(lines(dir)).toHaveLength(1);
    expect(lines(dir)[0]).not.toHaveProperty("progress");

    follow({ ...base, status: "done", out: "/out/nova_43_draft.mp4" });
    expect(actions.get(record.id)).toMatchObject({
      state: "done",
      result: "/out/nova_43_draft.mp4",
      offers: ["reveal"],
    });
    expect(actions.get(record.id)).not.toHaveProperty("progress");
    expect(lines(dir).map((l) => l.state)).toEqual(["running", "done"]);

    /* A finished job the list never saw running makes no record. */
    expect(follow({ ...base, jobId: "export-9", status: "done" })).toBeUndefined();
    expect(actions.list()).toHaveLength(1);

    /* A canceled job offers to run again. */
    follow({ ...base, jobId: "export-2", status: "running", progress: "starting" });
    follow({ ...base, jobId: "export-2", status: "canceled" });
    expect(actions.list()[1]).toMatchObject({ state: "canceled", offers: ["retry"] });
  });

  it("loads the file on start: finished records stay, an interrupted one is failed", () => {
    const dir = library();
    const now = clock();
    const first = createActionsLog(() => dir, { now });
    const done = first.add({
      kind: "export",
      showcaseId: "nova",
      label: "Screenshots",
      state: "running",
    });
    first.update(done.id, { state: "done", result: "/out/screens" });
    first.add({ kind: "build", showcaseId: "nova", label: "Build media", state: "running" });
    first.add({ kind: "commit", showcaseId: "nova", label: "Commit to git" }); // pending: not written

    now.tick(60_000);
    const again = createActionsLog(() => dir, { now });
    const loaded = again.list();
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toMatchObject({
      id: done.id,
      state: "done",
      result: "/out/screens",
      offers: [],
    });
    expect(loaded[1]).toMatchObject({
      kind: "build",
      state: "failed",
      error: "The studio stopped before this finished.",
      finishedAt: new Date(now()).toISOString(),
      offers: ["dismiss"],
    });
  });

  it("gives a job a new record when an earlier studio's job had the same id (issue #76)", () => {
    /* A studio's job ids start again at export-1 every time it starts,
     * so the file holds finished records with the ids the new studio's
     * jobs are about to use. */
    const dir = library();
    const now = clock();
    const follow = (actions, status) =>
      actions.job(status, { kind: "export", label: "Screenshots" });
    const base = { jobId: "export-1", kind: "screens", by: "user" };
    const first = createActionsLog(() => dir, { now });
    follow(first, { ...base, showcaseId: "nova", status: "running" });
    follow(first, { ...base, showcaseId: "nova", status: "done", out: "/out/nova/screens" });

    now.tick(3 * 24 * 3600_000);
    const changes = [];
    const again = createActionsLog(() => dir, { now, onChange: (r) => changes.push(r) });
    follow(again, { ...base, showcaseId: "orbit", status: "running", progress: "starting" });
    follow(again, { ...base, showcaseId: "orbit", status: "done", out: "/out/orbit/screens" });

    const [old, fresh] = again.list();
    expect(old).toMatchObject({ showcaseId: "nova", result: "/out/nova/screens" });
    expect(fresh).toMatchObject({
      showcaseId: "orbit",
      state: "done",
      result: "/out/orbit/screens",
    });
    expect(changes.map((r) => [r.showcaseId, r.state])).toEqual([
      ["orbit", "running"],
      ["orbit", "done"],
    ]);
    expect(lines(dir).map((l) => [l.showcaseId, l.state])).toEqual([
      ["nova", "running"],
      ["nova", "done"],
      ["orbit", "running"],
      ["orbit", "done"],
    ]);
  });

  it("keeps only the newest finished records, and survives a torn line", () => {
    const dir = library();
    mkdirSync(path.join(dir, ".studio"), { recursive: true });
    writeFileSync(path.join(dir, ACTIONS_LOG), '{"id":"x","state":"done","kind":"exp\n');
    const actions = createActionsLog(() => dir, { keep: 2 });
    expect(actions.list()).toEqual([]);
    for (let i = 0; i < 4; i++) {
      const { id } = actions.add({ kind: "export", showcaseId: "nova", state: "running" });
      actions.update(id, { state: "done" });
    }
    const pending = actions.add({ kind: "commit", showcaseId: "nova" });
    expect(actions.list().map((a) => a.state)).toEqual(["done", "done", "pending"]);
    expect(actions.get(pending.id)).toBeDefined();
  });

  it("switches with the library", () => {
    const a = library();
    const b = library();
    let dir = a;
    const actions = createActionsLog(() => dir);
    const { id } = actions.add({ kind: "export", showcaseId: "nova", state: "running" });
    actions.update(id, { state: "done" });
    dir = b;
    expect(actions.list()).toEqual([]);
    expect(actions.path()).toBe(path.join(b, ACTIONS_LOG));
    dir = a;
    expect(actions.list()).toHaveLength(1);
  });

  it("says who started it when nobody said why", () => {
    expect(defaultWhy("user")).toBe("Started by you");
    expect(defaultWhy("claude")).toBe("Started by Claude");
    expect(defaultWhy("studio")).toBe("Started by the studio");
  });
});
