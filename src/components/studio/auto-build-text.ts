/* The words the "Build media when it changes" switch (StudioSettings.tsx)
 * shows, kept apart from the component so the page's hot reload keeps
 * working. */

export const AUTO_BUILD_HELP =
  "A showcase cut from a recording or read by a synthesized voice gets its voiceover, " +
  "clips and timings built a few seconds after you change them, and before any export. " +
  "Off, the build still runs before an export, and when Claude asks for it.";

/** What the switch's tooltip says. `null` means no studio has said yet. */
export function autoBuildExplanation(on: boolean | null): string {
  if (on === null) return "Checking…";
  return AUTO_BUILD_HELP;
}
