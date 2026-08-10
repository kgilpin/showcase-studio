import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { fontLinks, getShowcase, themeVars } from "@/content/showcases";

/* Layout for every page of one showcase: validates the id, applies the
 * showcase's resolved theme (CSS-variable overrides) to the whole subtree,
 * and loads any font stylesheets the theme declares. */
export const Route = createFileRoute("/showcase/$showcaseId")({
  head: ({ params }) => {
    const showcase = getShowcase(params.showcaseId);
    return {
      meta: showcase
        ? [
            { title: showcase.title },
            { name: "description", content: showcase.description },
            { property: "og:title", content: showcase.title },
            { property: "og:description", content: showcase.description },
          ]
        : [{ title: "Showcase not found" }],
      links: showcase ? fontLinks(showcase) : [],
    };
  },
  component: ShowcaseLayout,
});

function ShowcaseLayout() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  if (!showcase) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <p>
          No showcase named &quot;{showcaseId}&quot; —{" "}
          <Link to="/" className="underline">
            see all showcases
          </Link>
        </p>
      </main>
    );
  }
  return (
    <div data-showcase={showcase.id} style={themeVars(showcase)}>
      <Outlet />
    </div>
  );
}
