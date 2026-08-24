/* The shared teleprompter page (prompter site, see cdk/).
 *
 * One page, one job: /p/<token> fetches scripts/<token>.json — the
 * snapshot the studio published (server/prompter-script.mjs) — and runs
 * the same ScriptPlayer the studio uses, camera takes included. The
 * recording downloads straight to this device; nothing goes back to the
 * studio. The page lands directly in the prompter, paused — playing and
 * recording each start from their own deliberate tap (with a 3-2-1
 * countdown), so no cover screen fronts it. */
import { useEffect, useState } from "react";
import { ScriptPlayer } from "@/components/script/ScriptPlayer";
import type { Scene, SceneCaption } from "@/content/showcases";

type SnapshotScene = {
  id: string;
  eyebrow?: string;
  durationMs: number;
  captions: SceneCaption[];
  support?: string;
};

type PrompterScript = {
  version: number;
  id: string;
  title: string;
  publishedAt?: string;
  scenes: SnapshotScene[];
};

/** The snapshot carries only what the prompter reads; the display-only
 *  Scene fields are filled with inert defaults. */
function toScenes(script: PrompterScript): Scene[] {
  return script.scenes.map((scene) => ({
    theme: "statement",
    media: { kind: "none" },
    ...scene,
  }));
}

function tokenFromLocation(): string | undefined {
  const match = /^\/p\/([A-Za-z0-9_-]+)\/?$/.exec(window.location.pathname);
  return match?.[1] ?? new URLSearchParams(window.location.search).get("t") ?? undefined;
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "reading"; script: PrompterScript };

export function PrompterApp() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const token = tokenFromLocation();
    if (!token) {
      setState({ kind: "error", message: "This page needs a script link to show." });
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/scripts/${token}.json`);
        if (!response.ok) {
          setState({
            kind: "error",
            message:
              response.status === 404 || response.status === 403
                ? "This script link has expired or was never published."
                : `The script could not be loaded (${response.status}).`,
          });
          return;
        }
        const script = (await response.json()) as PrompterScript;
        if (script.version !== 1 || !Array.isArray(script.scenes)) {
          setState({ kind: "error", message: "This script was published by a newer studio." });
          return;
        }
        setState({ kind: "reading", script });
      } catch {
        setState({
          kind: "error",
          message: "The script could not be loaded — check the connection.",
        });
      }
    })();
  }, []);

  if (state.kind === "reading") {
    // No onExit: the prompter is this page — there is nowhere to exit to.
    return <ScriptPlayer scenes={toScenes(state.script)} takeName={state.script.id} />;
  }

  return (
    <main
      className="flex min-h-dvh w-full flex-col items-center justify-center px-8 text-center"
      style={{ background: "var(--gradient-stage)" }}
    >
      {state.kind === "loading" && <p className="text-sm text-support">Loading the script…</p>}
      {state.kind === "error" && (
        <p className="max-w-sm text-base leading-relaxed text-muted-foreground">{state.message}</p>
      )}
    </main>
  );
}
