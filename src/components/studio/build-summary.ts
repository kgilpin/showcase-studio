/* What a finished media build says in one line, kept out of
 * BuildMediaButton.tsx so that file exports only its components. */
import type { StudioBuildReport } from "@/lib/studio";

/** "Built 2 files · 1 left alone · 43.5s of showcase", or nothing when
 *  there is no report to summarize. */
export function buildSummary(report: StudioBuildReport | undefined): string | undefined {
  if (!report) return undefined;
  const { built = [], unchanged = [], totalMs } = report;
  const parts = [built.length === 1 ? "Built 1 file" : `Built ${built.length} files`];
  if (unchanged.length > 0) parts.push(`${unchanged.length} left alone`);
  if (typeof totalMs === "number") parts.push(`${(totalMs / 1000).toFixed(1)}s of showcase`);
  return parts.join(" · ");
}
