/* Background jobs: the async layer between long work and its callers —
 * the MCP tools and the studio's buttons. A studio runs two of these, one
 * for exports and one for media builds. Starting a job returns
 * immediately; callers poll status, or follow onChange, and can cancel
 * (cooperative — the work checks an AbortSignal between steps). One job
 * of each kind runs at a time, whoever started it.
 *
 *   start ──► running ──┬──► done      (out: the file or folder, or the
 *                       │               report a build hands back)
 *                       ├──► failed    (error)
 *                       └──► canceled
 *
 * onChange(status) runs on every step: start, each progress report, and
 * the end. The studio server sends it to its pages as the "export" or
 * "build" event, and records it in the Actions list (actions-log.mjs).
 *
 * A job remembers who started it — `by`: "user" (a button), "claude" (an
 * MCP tool) or "studio" (on its own) — and `why`, one sentence, so the
 * Actions list can say so. */

/** `name` names the job kind in its ids and refusals ("export", "build"),
 *  and `poll` is the tool a caller should poll. Anything passed to
 *  start() after the showcase id reaches the runner unchanged, with the
 *  job's own id as `jobId`; `by` and `why` are also kept on the job's
 *  status. */
export function createExportJobs(
  runner,
  { onChange = () => {}, name = "export", poll = "export_status" } = {},
) {
  let seq = 0;
  /** id → job. Finished jobs are kept so late status polls still answer. */
  const jobs = new Map();
  /** The newest job, running or not — what a page that just loaded shows. */
  let latest;

  const running = () => [...jobs.values()].find((job) => job.status === "running");

  const statusOf = (job) => {
    const { kind, showcaseId, status, progress, step, steps, out, error, by, why } = job;
    return { jobId: job.id, kind, showcaseId, status, progress, step, steps, out, error, by, why };
  };
  const changed = (job) => onChange(statusOf(job));

  return {
    start(kind, showcaseId, options = {}) {
      const active = running();
      if (active) {
        throw new Error(
          `${active.id} (${active.kind} of ${active.showcaseId}) is already running — ` +
            `poll ${poll} or cancel it first.`,
        );
      }
      const controller = new AbortController();
      const job = {
        id: `${name}-${++seq}`,
        kind,
        showcaseId,
        status: "running",
        progress: "starting",
        by: options.by ?? "user",
        why: options.why,
        controller,
      };
      jobs.set(job.id, job);
      latest = job;
      changed(job);
      runner(kind, showcaseId, {
        ...options,
        jobId: job.id,
        onProgress: (label, { step, steps } = {}) => {
          if (job.status !== "running") return;
          job.progress = label;
          job.step = step;
          job.steps = steps;
          changed(job);
        },
        signal: controller.signal,
      }).then(
        (out) => {
          if (job.status !== "running") return;
          job.status = "done";
          job.out = out;
          changed(job);
        },
        (error) => {
          if (job.status !== "running") return;
          job.status = controller.signal.aborted ? "canceled" : "failed";
          job.error = String(error?.message ?? error);
          changed(job);
        },
      );
      return statusOf(job);
    },

    status(id) {
      const job = jobs.get(id);
      return job ? statusOf(job) : undefined;
    },

    /** The running job, or else the newest finished one; undefined before
     *  the first export. */
    current() {
      const job = running() ?? latest;
      return job ? statusOf(job) : undefined;
    },

    cancel(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      if (job.status === "running") {
        job.status = "canceled";
        job.controller.abort();
        changed(job);
      }
      return statusOf(job);
    },
  };
}
