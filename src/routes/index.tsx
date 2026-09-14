import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { coverUrl, showcaseErrors, showcases } from "@/content/showcases";
import { DiagnosticsTray } from "@/components/showcase/DiagnosticsTray";
import { HomeBackNav } from "@/components/showcase/HomeBackNav";
import { NewShowcaseForm } from "@/components/studio/NewShowcaseForm";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";

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

/* Studio only: scaffolds a new showcase folder and opens straight into
 * its Claude Code terminal. Renders nothing in a plain browser. */
function NewShowcaseCard() {
  const [inStudio, setInStudio] = useState(false);
  const [editing, setEditing] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.showcases)), []);
  if (!inStudio) return null;

  return (
    <button
      type="button"
      onClick={() => !editing && setEditing(true)}
      className={cn(
        "flex min-h-56 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-card/20 p-7 text-left transition-colors hover:border-primary hover:bg-card/50",
        editing && "cursor-default",
      )}
    >
      <Plus className="size-10 text-primary" />
      {editing ? (
        <NewShowcaseForm />
      ) : (
        <span className="text-sm text-muted-foreground">New showcase</span>
      )}
    </button>
  );
}

function HomeScreen() {
  return (
    <main
      className="min-h-dvh w-full px-6 py-14 sm:px-10"
      style={{ background: "var(--gradient-stage)" }}
    >
      <HomeBackNav />
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
          {showcaseErrors.map((error) => (
            <div
              key={error.id}
              className="flex min-h-56 flex-col rounded-2xl border border-red-400/40 bg-card/40 p-7"
            >
              <h2 className="font-display text-2xl leading-snug tracking-tight text-foreground">
                {error.id}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-red-400">{error.message}</p>
              <p className="mt-auto pt-5 text-xs uppercase tracking-[0.28em] text-support">
                Didn't load — fix the file and save
              </p>
            </div>
          ))}
          <NewShowcaseCard />
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0">
        <DiagnosticsTray />
      </div>
    </main>
  );
}
