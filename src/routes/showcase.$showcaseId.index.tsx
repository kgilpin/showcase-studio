import { createFileRoute } from "@tanstack/react-router";
import { useShowcase } from "@/content/showcases";
import { ShowcasePlayer } from "@/components/showcase/ShowcasePlayer";

export const Route = createFileRoute("/showcase/$showcaseId/")({
  component: PlayerScreen,
});

function PlayerScreen() {
  const { showcaseId } = Route.useParams();
  /* Subscribed, not just read: in-app edits rebuild the showcase in
   * place and this screen must re-render without a page reload. */
  const showcase = useShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  return <ShowcasePlayer showcase={showcase} />;
}
