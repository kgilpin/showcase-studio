/* Export jobs: the async layer between the MCP export tools and the
 * exporter. Starting a job returns immediately; the caller polls status
 * and can cancel (cooperative — the exporter checks an AbortSignal
 * between captures). One job runs at a time. */

export function createExportJobs(runner) {
  let seq = 0;
  /** id → job. Finished jobs are kept so late status polls still answer. */
  const jobs = new Map();

  const running = () => [...jobs.values()].find((job) => job.status === "running");

  return {
    start(kind, showcaseId) {
      const active = running();
      if (active) {
        throw new Error(
          `Export ${active.id} (${active.kind} of ${active.showcaseId}) is already running — ` +
            `poll export_status or cancel it first.`,
        );
      }
      const controller = new AbortController();
      const job = {
        id: `export-${++seq}`,
        kind,
        showcaseId,
        status: "running",
        progress: "starting",
        controller,
      };
      jobs.set(job.id, job);
      runner(kind, showcaseId, {
        onProgress: (label) => {
          if (job.status === "running") job.progress = label;
        },
        signal: controller.signal,
      }).then(
        (out) => {
          if (job.status !== "running") return;
          job.status = "done";
          job.out = out;
        },
        (error) => {
          if (job.status !== "running") return;
          job.status = controller.signal.aborted ? "canceled" : "failed";
          job.error = String(error?.message ?? error);
        },
      );
      return this.status(job.id);
    },

    status(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      const { kind, showcaseId, status, progress, out, error } = job;
      return { jobId: job.id, kind, showcaseId, status, progress, out, error };
    },

    cancel(id) {
      const job = jobs.get(id);
      if (!job) return undefined;
      if (job.status === "running") {
        job.status = "canceled";
        job.controller.abort();
      }
      return this.status(id);
    },
  };
}
