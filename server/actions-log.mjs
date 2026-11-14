/* The Actions list: everything the studio does on someone's behalf that
 * takes time or can fail — an export, a media build, a git commit — as one
 * kind of record, so the page can show in one place what is running, what
 * is about to run, what happened, and what went wrong (issue #41).
 *
 *   pending ──► running ──► done
 *      │           │
 *      │           └──────► failed    (retry, rebuild, dismiss)
 *      └──────────────────► canceled  (skipped before it ran, or
 *                                      cancelled while it ran)
 *
 * Each record says what it is (kind, label), which showcase, who started
 * it (by: "user" | "claude" | "studio") and why, in one plain sentence.
 * While it runs it carries the job's own progress; when it ends, its
 * result or its error.
 *
 * The list is kept in memory and appended to <library>/.studio/actions.jsonl
 * — one line per state change (never per progress report), so a Claude
 * session can follow it the way it follows changes.jsonl:
 *
 *   tail -n 0 -F <library>/.studio/actions.jsonl | grep --line-buffered '"state":"failed"'
 *
 * A pending record is never written: it is a timer, and a studio that
 * stops forgets its timers. A record still "running" when the studio
 * starts again was interrupted, and is loaded as failed, saying so. The
 * file rotates to actions.1.jsonl past maxBytes, like the change log.
 *
 * What the user can do with a record (its offers) depends on its state
 * and on the handlers whoever added it passed in — the job lane's cancel,
 * a way to run it again, the pending timer's skip. Records loaded from
 * the file have no handlers, so they offer only dismiss.
 *
 * Who adds records: the export and build lanes report every job through
 * job(), and server/showcase-history.mjs records each commit. Pages read
 * the list over GET /studio/api/actions, hear each change as the
 * "action" event, and run an offer with the "actions-offer" action.
 * studio_info reports summary() as `actions`. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const ACTIONS_LOG = path.join(".studio", "actions.jsonl");
const ROTATED = path.join(".studio", "actions.1.jsonl");

const INTERRUPTED = "The studio stopped before this finished.";
const FINAL = new Set(["done", "failed", "canceled"]);

/** Which handlers a record offers in each state. "dismiss" needs no
 *  handler: it only clears the record's mark in the slot. */
const OFFERS = {
  pending: ["skip"],
  running: ["cancel"],
  failed: ["retry", "rebuild"],
  canceled: ["retry"],
  done: ["reveal"],
};

/** The default reason, when the adder gives none. */
export function defaultWhy(by) {
  if (by === "claude") return "Started by Claude";
  if (by === "studio") return "Started by the studio";
  return "Started by you";
}

/**
 * Creates the list for the library `getDir()` names.
 *
 *   onChange(record)  runs on every change to a record — a new one, a
 *                     progress report, an end — with the record as the
 *                     page sees it (offers included); the studio sends
 *                     it to pages as the "action" event
 *   keep              how many finished records stay in memory and in
 *                     list()
 */
export function createActionsLog(
  getDir,
  {
    maxBytes = 256 * 1024,
    keep = 100,
    log = console.warn,
    onChange = () => {},
    now = Date.now,
  } = {},
) {
  /** id → { record, handlers } in insertion order. */
  let items = new Map();
  let seq = 0;
  let loadedFrom = null;

  const stamp = () => new Date(now()).toISOString();

  /** The record as the page sees it. */
  const publicOf = ({ record, handlers }) => ({
    ...record,
    offers: [
      ...(OFFERS[record.state] ?? []).filter((name) => typeof handlers[name] === "function"),
      ...(record.state === "failed" && !record.dismissed ? ["dismiss"] : []),
    ],
  });

  const changed = (item) => onChange(publicOf(item));

  const readLines = (file) => {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          return line.trim() ? [JSON.parse(line)] : [];
        } catch {
          return []; // a torn line from a crash, or a hand edit
        }
      });
  };

  /** Appends one line. Never throws: a list that can't be written must
   *  not fail the work it describes. */
  function write(record) {
    const { progress: _p, step: _s, steps: _ss, ...line } = record;
    try {
      const file = path.join(getDir(), ACTIONS_LOG);
      mkdirSync(path.dirname(file), { recursive: true });
      const text = `${JSON.stringify({ at: stamp(), ...line })}\n`;
      if (existsSync(file) && statSync(file).size + Buffer.byteLength(text) > maxBytes) {
        renameSync(file, path.join(getDir(), ROTATED));
      }
      appendFileSync(file, text);
    } catch (error) {
      log(`studio: couldn't write the actions list (${error.message})`);
    }
  }

  /** Drops the oldest finished records past `keep`. */
  function trim() {
    const finished = [...items.values()].filter(({ record }) => FINAL.has(record.state));
    for (const { record } of finished.slice(0, Math.max(0, finished.length - keep))) {
      items.delete(record.id);
    }
  }

  /** Reads the library's file into memory: the latest line of each
   *  record wins, and a record the studio left running is failed. */
  function load() {
    const dir = getDir();
    loadedFrom = dir;
    const folded = new Map();
    const lines = [
      ...readLines(path.join(dir, ROTATED)),
      ...readLines(path.join(dir, ACTIONS_LOG)),
    ];
    for (const line of lines) {
      if (!line?.id) continue;
      const { at: _at, ...fields } = line;
      folded.set(line.id, { ...(folded.get(line.id) ?? {}), ...fields });
    }
    items = new Map();
    for (const record of folded.values()) {
      if (record.state === "running") {
        Object.assign(record, { state: "failed", error: INTERRUPTED, finishedAt: stamp() });
      }
      if (!FINAL.has(record.state)) continue;
      items.set(record.id, { record, handlers: {} });
    }
    trim();
  }

  /** The list is for one library; a switch reloads it. */
  const current = () => {
    if (loadedFrom !== getDir()) load();
    return items;
  };

  const api = {
    /** The list file's path in the current library. */
    path: () => path.join(getDir(), ACTIONS_LOG),

    /**
     * Adds a record and returns it. `fields`: kind, showcaseId, by, why,
     * label, state ("pending" with dueAt, or "running"), and anything
     * else worth keeping (jobId). `handlers` are what its offers run:
     * skip (pending), cancel (running), retry / rebuild (failed or
     * canceled), reveal (done). Each gets the record.
     */
    add(fields, handlers = {}) {
      const list = current();
      const state = fields.state ?? "pending";
      const record = {
        id: `${fields.kind ?? "action"}-${now().toString(36)}-${++seq}`,
        by: "user",
        ...fields,
        why: fields.why ?? defaultWhy(fields.by ?? "user"),
        state,
        ...(state === "running" ? { startedAt: stamp() } : {}),
      };
      const item = { record, handlers };
      list.set(record.id, item);
      if (state === "running") write(record);
      changed(item);
      return publicOf(item);
    },

    /**
     * Changes a record. A new state writes a line (and stamps startedAt
     * or finishedAt); a progress report only reaches the pages. Marking
     * a record dismissed writes a line too, so it stays dismissed.
     * Returns the record, or undefined for an id the list doesn't hold.
     */
    update(id, patch = {}) {
      const item = current().get(id);
      if (!item) return undefined;
      const { record } = item;
      const before = record.state;
      Object.assign(record, patch);
      if (patch.state && patch.state !== before) {
        if (patch.state === "running") record.startedAt = stamp();
        if (FINAL.has(patch.state)) {
          record.finishedAt = stamp();
          delete record.progress;
          delete record.step;
          delete record.steps;
          delete record.dueAt;
        }
        write(record);
        trim();
      } else if (patch.dismissed !== undefined) {
        write(record);
      }
      changed(item);
      return publicOf(item);
    },

    /** Forgets a pending record that turned out to have nothing to do
     *  (a commit timer that found the folder clean). The pages hear it
     *  as state "dropped". */
    drop(id) {
      const item = current().get(id);
      if (!item || item.record.state !== "pending") return;
      current().delete(id);
      onChange({ ...item.record, state: "dropped", offers: [] });
    },

    /** Runs one of a record's offers. Resolves with { ok } or
     *  { ok: false, error }. */
    async perform(id, offer) {
      const item = current().get(id);
      if (!item) return { ok: false, error: "That action is no longer listed" };
      if (offer === "dismiss") {
        if (item.record.state !== "failed") {
          return { ok: false, error: "Only a failure is dismissed" };
        }
        api.update(id, { dismissed: true });
        return { ok: true };
      }
      if (!publicOf(item).offers.includes(offer)) {
        return { ok: false, error: `"${offer}" isn't offered for this action now` };
      }
      try {
        await item.handlers[offer](publicOf(item));
        return { ok: true };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },

    get(id) {
      const item = current().get(id);
      return item ? publicOf(item) : undefined;
    },

    /** Every record the list holds, oldest first: all pending and
     *  running ones, and the newest `keep` finished ones. */
    list() {
      return [...current().values()].map(publicOf);
    },

    /** The short form for studio_info: how many are pending, running
     *  and failed (not dismissed), the failures themselves, and the
     *  file to follow. */
    summary() {
      const all = api.list();
      const failed = all.filter((a) => a.state === "failed" && !a.dismissed);
      return {
        pending: all.filter((a) => a.state === "pending").length,
        running: all.filter((a) => a.state === "running").length,
        failed: failed.map(({ id, kind, label, showcaseId, by, error }) => ({
          id,
          kind,
          label,
          showcaseId,
          by,
          error,
        })),
        path: api.path(),
      };
    },

    /**
     * Follows a job lane (server/export-jobs.mjs): call it with every
     * status the lane reports, and the job's record is added on its
     * first report and kept current after. `kind` is the record's kind
     * ("export", "build"), `label` names the job for people, and
     * `handlers` are the record's offers (cancel, retry, rebuild,
     * reveal), each given the record.
     */
    job(status, { kind = "export", label, handlers = {} } = {}) {
      const list = current();
      const item = [...list.values()].find(({ record }) => record.jobId === status.jobId);
      if (!item) {
        if (status.status !== "running") return undefined;
        return api.add(
          {
            kind,
            jobId: status.jobId,
            jobKind: status.kind,
            showcaseId: status.showcaseId,
            by: status.by ?? "user",
            why: status.why,
            label: label ?? status.kind,
            state: "running",
            progress: status.progress,
          },
          handlers,
        );
      }
      const { id } = item.record;
      if (status.status === "running") {
        return api.update(id, {
          progress: status.progress,
          step: status.step,
          steps: status.steps,
        });
      }
      if (status.status === "done") return api.update(id, { state: "done", result: status.out });
      if (status.status === "canceled") return api.update(id, { state: "canceled" });
      return api.update(id, { state: "failed", error: status.error });
    },
  };
  return api;
}
