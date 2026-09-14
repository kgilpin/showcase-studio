import { useState } from "react";
import { studio } from "@/lib/studio";

/* Studio only: names and scaffolds a new showcase, then opens it with its
 * Claude Code terminal. Shown by the home page's "+" card and by the /new
 * page (where a window launched with --new lands). */
export function NewShowcaseForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setError(null);
    const result = await studio()!.showcases.create(name);
    if (!result.ok || !result.id) {
      setError(result.error ?? "Could not create the showcase");
      return;
    }
    // Reopen the agent (terminal) after the folder watcher reloads the app.
    sessionStorage.setItem("studio-open-agent", "1");
    window.location.href = `/showcase/${result.id}`;
  };

  return (
    <div className="flex w-full flex-col gap-2" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void create()}
        placeholder="Name the app or product…"
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-support/60"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <span
        role="button"
        onClick={() => void create()}
        className="rounded-lg border border-border bg-card px-3 py-2 text-center text-sm text-foreground transition-colors hover:bg-secondary"
      >
        Create
      </span>
    </div>
  );
}
