import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { HomeBackNav } from "@/components/showcase/HomeBackNav";
import { NewShowcaseForm } from "@/components/studio/NewShowcaseForm";
import { studio } from "@/lib/studio";

/* The New Showcase page: where a window launched with --new lands, and
 * stays until it creates a showcase. Creating needs the desktop studio,
 * so a plain browser only gets an explanation. */
export const Route = createFileRoute("/new")({
  head: () => ({ meta: [{ title: "New showcase" }] }),
  component: NewShowcaseScreen,
});

function NewShowcaseScreen() {
  const [inStudio, setInStudio] = useState<boolean | null>(null);
  useEffect(() => setInStudio(Boolean(studio()?.showcases)), []);

  return (
    <main
      className="flex min-h-dvh w-full items-center justify-center px-6 py-14"
      style={{ background: "var(--gradient-stage)" }}
    >
      <HomeBackNav />
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-dashed border-border bg-card/20 p-10">
        <Plus className="size-10 text-primary" />
        <h1 className="font-display text-4xl leading-tight tracking-tight text-foreground">
          New showcase
        </h1>
        {inStudio === false && (
          <p className="text-center text-sm text-muted-foreground">
            Creating a showcase needs the desktop studio.
          </p>
        )}
        {inStudio && <NewShowcaseForm />}
      </div>
    </main>
  );
}
