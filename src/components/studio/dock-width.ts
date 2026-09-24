/* How much room the studio agent's docked panel asks the page layout to
 * leave for it (StudioAgent tells the root layout through onDock). */

/** The room the docked panel asks the root layout to leave for it. */
export const DOCK_WIDTH = 640;

/** How much room to ask for — nothing unless the panel is really on
 *  screen. It asks for none in the same cases StudioAgent renders
 *  nothing, or the page is left with an empty 640px gap: no terminals
 *  (the studio Claude Code starts turns them off), no showcase, or a
 *  page being captured for a screenshot or video. */
export function dockWidth({
  available,
  open,
  showcaseId,
  capturing,
}: {
  available: boolean;
  open: boolean;
  showcaseId: string | undefined;
  capturing: boolean;
}) {
  return available && open && Boolean(showcaseId) && !capturing ? DOCK_WIDTH : 0;
}
