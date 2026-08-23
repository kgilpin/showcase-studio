/* The shared teleprompter page (prompter site, see cdk/).
 *
 * One page, one job: /p/<token> fetches scripts/<token>.json — the
 * snapshot the studio published (server/prompter-script.mjs) — and runs
 * the same ScriptPlayer the studio uses, camera takes included. The
 * recording downloads straight to this device; nothing goes back to the
 * studio. A cover screen fronts the prompter so reading (and the camera
 * permission prompt) starts from a deliberate tap. */
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
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
  | { kind: "cover"; script: PrompterScript }
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
        setState({ kind: "cover", script });
      } catch {
        setState({
          kind: "error",
          message: "The script could not be loaded — check the connection.",
        });
      }
    })();
  }, []);

  if (state.kind === "reading") {
    return (
      <ScriptPlayer
        scenes={toScenes(state.script)}
        takeName={state.script.id}
        onExit={() => setState({ kind: "cover", script: state.script })}
      />
    );
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
      {state.kind === "cover" && (
        <>
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Teleprompter</p>
          <h1 className="mt-5 font-display text-4xl leading-tight tracking-tight text-foreground">
            {state.script.title}
          </h1>
          <p className="mt-4 text-sm text-support">
            {state.script.scenes.length} slides ·{" "}
            {Math.round(state.script.scenes.reduce((sum, s) => sum + s.durationMs, 0) / 1000)}s ·
            turn on the camera in the prompter to film a take — recordings save on this device
          </p>
          <button
            type="button"
            onClick={() => setState({ kind: "reading", script: state.script })}
            className="mt-10 inline-flex items-center gap-2 rounded-full border border-transparent bg-primary px-7 py-3.5 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <Play className="size-5" /> Start reading
          </button>
        </>
      )}
    </main>
  );
}
