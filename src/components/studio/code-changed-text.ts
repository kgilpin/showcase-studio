/* The words of the code-changed banner (CodeChangedBanner.tsx), on their
 * own so the component file exports only components (fast refresh). */

/** How many changed files the banner names before "and N more". */
const NAMED = 3;

/** The files' part of the banner: "server/a.mjs, src/b.mjs and 2 more". */
export function changedCodeSummary(changed: string[]): string {
  const named = changed.slice(0, NAMED).join(", ");
  const more = changed.length - NAMED;
  return more > 0 ? `${named} and ${more} more` : named;
}
