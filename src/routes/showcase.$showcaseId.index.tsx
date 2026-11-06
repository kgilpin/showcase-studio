import { createFileRoute } from "@tanstack/react-router";
import { useShowcase } from "@/content/showcases";
import { ShowcasePlayer } from "@/components/showcase/ShowcasePlayer";
import { playerView, type PlayerView } from "@/lib/export-kinds.mjs";

/* The player. `?view=tiktok|screens|embed` opens it in that view — for a
 * link, or the URL studio_start hands Claude — and wins over the
 * showcase's own meta.view. Anything else is ignored. */
export const Route = createFileRoute("/showcase/$showcaseId/")({
  validateSearch: (search: Record<string, unknown>): { view?: PlayerView } => {
    const view = playerView(search["view"]);
    return view ? { view } : {};
  },
  component: PlayerScreen,
});

function PlayerScreen() {
  const { showcaseId } = Route.useParams();
  const { view } = Route.useSearch();
  /* Subscribed, not just read: in-app edits rebuild the showcase in
   * place and this screen must re-render without a page reload. */
  const showcase = useShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  return <ShowcasePlayer showcase={showcase} initialView={view} />;
}
