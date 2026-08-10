import { createFileRoute } from "@tanstack/react-router";
import { getShowcase } from "@/content/showcases";
import { ShowcasePlayer } from "@/components/showcase/ShowcasePlayer";

export const Route = createFileRoute("/showcase/$showcaseId/")({
  component: PlayerScreen,
});

function PlayerScreen() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  return <ShowcasePlayer showcase={showcase} />;
}
