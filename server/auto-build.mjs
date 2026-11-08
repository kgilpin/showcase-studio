/* Builds a showcase's media on its own when its inputs change (issue
 * #37). A showcase cut from a recording or voiced by Polly derives its
 * voiceover, clips, word timings and every durationMs from the cut list
 * or the captions; until now a person had to press a button after each
 * edit, and the only sign the media was stale was a video out of step
 * with its captions. The studio already knows when inputs change (its
 * own writes arrive through the change log, outside edits through the
 * file watcher) and whether anything is out of date (media-status.mjs),
 * so it runs the build itself:
 *
 *   edit lands (change log or file watcher)
 *           │
 *           ▼
 *   a built showcase?  ── no ──► nothing
 *           │ yes
 *           ▼
 *   quiet period (a pending record in the Actions list, with Skip)
 *           │
 *           ▼
 *   mediaStatus ── up to date ──► the record is dropped
 *           │ stale
 *           ▼
 *   buildJobs.start, by "studio" — the job's own record takes over
 *
 * A build already running is left to finish; a change during it queues
 * one more quiet period after. A build that fails, or a cut list that
 * doesn't read yet (a take missing while the author is still writing
 * the list), is reported once: not again until the inputs change, so a
 * half-written showcase doesn't fail the list on every keystroke, and a
 * build that failed (whoever started it) isn't run again until they do.
 * The "Build media when it changes" switch turns the whole thing off; the
 * build_media and build_voiceover tools still run on request.
 *
 * ensureBuilt() is the same check for an export or a screenshot: build
 * first when anything is stale, and wait for it, so nothing renders
 * from stale clips. */
import { describeStale } from "./media-status.mjs";

/** How long after a build ends its own writes may still echo through
 *  the file watcher. */
const SETTLE_MS = 2_000;
const WAIT_POLL_MS = 100;

/**
 *   getLibrary()         the library folder
 *   buildJobs            the media-build lane (export-jobs.mjs)
 *   status(showcaseId)   mediaStatus for one showcase
 *   actions              the Actions list (actions-log.mjs), or null
 *   enabled()            the switch: false turns the automatic build off
 *   delayMs              the quiet period after a change
 */
export function createAutoBuild({
  buildJobs,
  status,
  actions = null,
  enabled = () => true,
  delayMs = 3000,
  log = console.warn,
  now = Date.now,
}) {
  const timers = new Map(); // showcaseId → the quiet period's timer
  const pendingRecords = new Map(); // showcaseId → the pending record's id
  const failedRecords = new Map(); // showcaseId → the failure we reported
  const again = new Set(); // changed while a build ran
  /** showcaseId → the status print a build failed on, or the problem the
   *  list was told — not reported again until the inputs change. */
  const failures = new Map();
  const endedAt = new Map(); // showcaseId → when its last build ended

  const cancelTimer = (showcaseId) => {
    clearTimeout(timers.get(showcaseId));
    timers.delete(showcaseId);
  };

  /** Ends the showcase's pending record without a build: `skipped` when
   *  someone chose that, else quietly dropped. */
  function forgetPending(showcaseId, { skipped = false } = {}) {
    const id = pendingRecords.get(showcaseId);
    pendingRecords.delete(showcaseId);
    if (!id || !actions) return;
    if (skipped) actions.update(id, { state: "canceled" });
    else actions.drop(id);
  }

  const building = (showcaseId) => {
    const job = buildJobs.current();
    return job?.status === "running" && (!showcaseId || job.showcaseId === showcaseId);
  };

  /** Starts a build of the showcase, by whoever `by` names. */
  function start(showcaseId, kind, options) {
    try {
      return buildJobs.start(kind === "voiceover" ? "voiceover" : "build", showcaseId, options);
    } catch (error) {
      /* Another build got in first: this one goes again after it. */
      again.add(showcaseId);
      log(`studio: build of ${showcaseId} waits (${error?.message ?? error})`);
      return undefined;
    }
  }

  /** Reports a cut list that doesn't read, once per distinct problem. */
  function reportProblem(showcaseId, problem) {
    const id = pendingRecords.get(showcaseId);
    pendingRecords.delete(showcaseId);
    if (!actions) return;
    const fields = {
      state: "failed",
      error: problem,
      why: `${showcaseId} changed, but its media can't be built yet`,
    };
    const record = id && actions.get(id)?.state === "pending" ? actions.update(id, fields) : null;
    if (record) failedRecords.set(showcaseId, record.id);
  }

  /** The quiet period is over: build if anything is out of date. */
  function fire(showcaseId) {
    if (building()) {
      /* Left to finish; this showcase goes again after it. */
      again.add(showcaseId);
      return;
    }
    let current;
    try {
      current = status(showcaseId);
    } catch (error) {
      current = { built: true, ok: false, problem: String(error?.message ?? error) };
    }
    if (!current.built || (current.ok && current.upToDate)) {
      forgetPending(showcaseId);
      return;
    }
    const seen = current.ok ? current.print : current.problem;
    if (failures.get(showcaseId) === seen) {
      forgetPending(showcaseId);
      return;
    }
    if (!current.ok) {
      failures.set(showcaseId, current.problem);
      reportProblem(showcaseId, current.problem);
      return;
    }
    forgetPending(showcaseId);
    start(showcaseId, current.kind, {
      by: "studio",
      why: `${showcaseId} changed — ${describeStale(current.stale)}`,
    });
  }

  /** Starts (or restarts) the showcase's quiet period — for a showcase
   *  that derives media at all; an edit to any other is nothing to the
   *  build, and gets no record. */
  function schedule(showcaseId, why) {
    if (!enabled()) return;
    let current;
    try {
      current = status(showcaseId);
    } catch {
      return;
    }
    if (!current.built) return;
    cancelTimer(showcaseId);
    const dueAt = new Date(now() + delayMs).toISOString();
    if (actions) {
      const id = pendingRecords.get(showcaseId);
      if (id && actions.get(id)?.state === "pending") actions.update(id, { dueAt, why });
      else {
        const record = actions.add(
          {
            kind: "build",
            showcaseId,
            by: "studio",
            why,
            label: "Build media",
            state: "pending",
            dueAt,
          },
          {
            skip: () => {
              cancelTimer(showcaseId);
              forgetPending(showcaseId, { skipped: true });
            },
            /* A build the list was told can't run yet, or was skipped:
             * run it now, whatever the status says. */
            retry: () => {
              failures.delete(showcaseId);
              const current = status(showcaseId);
              start(showcaseId, current.kind, {
                by: "user",
                why: "Tried again from the Actions list",
              });
            },
          },
        );
        pendingRecords.set(showcaseId, record.id);
      }
    }
    const timer = setTimeout(() => {
      timers.delete(showcaseId);
      fire(showcaseId);
    }, delayMs);
    timer.unref?.();
    timers.set(showcaseId, timer);
  }

  /** Polls the lane until the job ends. */
  const waitFor = (jobId) =>
    new Promise((resolve) => {
      const poll = () => {
        const job = buildJobs.status(jobId);
        if (!job || job.status !== "running") return resolve(job);
        setTimeout(poll, WAIT_POLL_MS).unref?.();
      };
      poll();
    });

  return {
    /** A file changed: `file` is relative to the library. The build's
     *  own writes — while it runs and for a moment after — are not
     *  changes. */
    noteChange(file) {
      if (file == null) return;
      const [first, ...rest] = String(file).split(/[/\\]/);
      if (!first || first.startsWith(".") || rest.length === 0) return;
      if (building(first) || now() - (endedAt.get(first) ?? 0) < SETTLE_MS) return;
      schedule(first, `${first} changed`);
    },

    /** A change the studio logged for a showcase (change-log.mjs): an
     *  edit to showcase.yaml, an asset added, renamed, deleted or
     *  encoded, a transcript saved. The build's own log line, a commit
     *  and a setting are not changes to its inputs. */
    noteShowcase(showcaseId, kind) {
      if (!showcaseId || !kind) return;
      if (["build", "commit", "setting", "showcase.create"].includes(kind)) return;
      const what =
        kind === "edit"
          ? "showcase.yaml changed"
          : kind === "transcript"
            ? "the transcript changed"
            : kind.startsWith("asset")
              ? "assets changed"
              : `${kind}`;
      schedule(showcaseId, `${showcaseId}: ${what}`);
    },

    /** Every build's end, whoever started it: a change that waited goes
     *  again, a success clears the showcase's failure and dismisses the
     *  failure the list showed for it. */
    jobEnded(job) {
      if (!job || job.status === "running") return;
      const { showcaseId } = job;
      endedAt.set(showcaseId, now());
      if (job.status === "done") {
        failures.delete(showcaseId);
        const id = failedRecords.get(showcaseId);
        failedRecords.delete(showcaseId);
        if (id && actions && actions.get(id)?.state === "failed") {
          actions.update(id, { dismissed: true });
        }
      } else if (job.status === "failed") {
        /* Not again on the same inputs, whoever started it: a build Claude
         * ran fails for the same reason the studio's would, and the job's
         * own record says why already. */
        try {
          const current = status(showcaseId);
          if (current.built && current.ok) failures.set(showcaseId, current.print);
        } catch {
          /* then it is tried again next time */
        }
      }
      for (const waiting of [...again]) {
        again.delete(waiting);
        schedule(waiting, `${waiting} changed while a build ran`);
      }
    },

    /**
     * Builds first when anything is out of date, and waits for it:
     * what an export or a screenshot calls before rendering. Resolves
     * `{built: false, status}` when there was nothing to do (or nothing
     * that can be built yet — the render goes ahead with what is there),
     * `{built: true, job}` after a build; rejects when the build fails,
     * with its error.
     */
    async ensureBuilt(showcaseId, { by = "studio", why, onProgress } = {}) {
      const current = status(showcaseId);
      if (!current.built || !current.ok || current.upToDate) {
        return { built: false, status: current };
      }
      cancelTimer(showcaseId);
      forgetPending(showcaseId);
      let job = buildJobs.current();
      if (job?.status === "running" && job.showcaseId !== showcaseId) {
        onProgress?.(`waiting for the build of ${job.showcaseId}`);
        await waitFor(job.jobId);
        job = undefined;
      }
      if (!(job?.status === "running")) {
        job = buildJobs.start(current.kind === "voiceover" ? "voiceover" : "build", showcaseId, {
          by,
          why: why ?? `${showcaseId}'s media was out of date — ${describeStale(current.stale)}`,
        });
      }
      onProgress?.("building the media first");
      const ended = await waitFor(job.jobId);
      if (!ended || ended.status !== "done") {
        throw new Error(
          ended?.status === "canceled"
            ? "The media build was canceled"
            : `The media build failed: ${ended?.error ?? "unknown error"}`,
        );
      }
      return { built: true, job: ended };
    },

    /** Drops every build still waiting for its quiet period. The studio
     *  calls it when the user turns the automatic build off. */
    cancelPending() {
      for (const showcaseId of [...timers.keys()]) {
        cancelTimer(showcaseId);
        forgetPending(showcaseId, { skipped: true });
      }
      again.clear();
    },

    /** The quiet periods still running, for tests and studio_info. */
    pending() {
      return [...timers.keys()];
    },

    close() {
      for (const showcaseId of [...timers.keys()]) cancelTimer(showcaseId);
    },
  };
}
