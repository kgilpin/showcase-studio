import { createFileRoute, Link } from "@tanstack/react-router";
import { coverUrl, showcases } from "@/content/showcases";

const title = "App Showcases";
const description = "Auto-playing, video-style product tours. Pick an app to watch its showcase.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: HomeScreen,
});

const totalSeconds = (ms: number) => `${Math.round(ms / 1000)}s`;

function HomeScreen() {
  return (
    <main
      className="min-h-dvh w-full px-6 py-14 sm:px-10"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-border pb-10">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Showcases</p>
          <h1 className="mt-4 font-display text-5xl leading-tight tracking-tight text-foreground">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        </header>

        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {showcases.map((showcase) => {
            const cover = coverUrl(showcase);
            const runtime = showcase.scenes.reduce((sum, s) => sum + s.durationMs, 0);
            return (
              <Link
                key={showcase.id}
                to="/showcase/$showcaseId"
                params={{ showcaseId: showcase.id }}
                className="group rounded-2xl border border-border bg-card/40 p-7 transition-colors hover:border-primary hover:bg-card/70"
              >
                {cover && (
                  <div className="relative mb-6 flex h-28 items-center justify-center">
                    <div
                      aria-hidden
                      className="absolute inset-x-8 inset-y-2 rounded-full bg-[var(--gradient-accent)] opacity-30 blur-[40px]"
                    />
                    <img src={cover} alt="" className="relative max-h-full w-auto object-contain" />
                  </div>
                )}
                <h2 className="font-display text-2xl leading-snug tracking-tight text-foreground">
                  {showcase.title}
                </h2>
                <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                  {showcase.description}
                </p>
                <p className="mt-5 text-xs uppercase tracking-[0.28em] text-support">
                  {showcase.scenes.length} slides · {totalSeconds(runtime)} ·{" "}
                  {showcase.loop ? "loops" : "plays once"}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
