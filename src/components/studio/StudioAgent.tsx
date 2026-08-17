import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { ExternalLink, Minus, RotateCcw, Sparkles, TerminalSquare, X } from "lucide-react";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { TerminalPane } from "./TerminalPane";

type TermView = "loading" | "chooser" | "integrated" | "external";

/* The studio agent: each showcase has its own Claude Code session,
 * running in that showcase's folder on the user's subscription. Shown
 * only inside a showcase; integrated sessions dock as a full-height
 * right sidebar (the root layout pads the content over) and resume
 * their previous conversation via `claude --continue`. Renders nothing
 * in a plain browser — the bridge only exists inside Electron. */
export function StudioAgent({ onDock }: { onDock?: (px: number) => void }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [termView, setTermView] = useState<TermView>("loading");
  const [termSession, setTermSession] = useState(1);
  const [termExited, setTermExited] = useState<number | null>(null);

  /* The panel shows the session for the showcase currently on screen. */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const showcaseId = /^\/showcase\/([^/]+)/.exec(pathname)?.[1];

  useEffect(() => {
    setTermExited(null);
    setTermView("loading");
  }, [showcaseId]);

  useEffect(() => {
    // The new-showcase flow reloads the app, then wants the terminal open.
    if (sessionStorage.getItem("studio-open-agent")) {
      sessionStorage.removeItem("studio-open-agent");
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    void studio()
      ?.terminal?.available()
      .then(({ ptyReady }) => setAvailable(ptyReady));
  }, []);

  /* Entering the panel: reattach if the session is running, otherwise
   * offer the integrated/external choice. */
  useEffect(() => {
    if (!open || !showcaseId || termView !== "loading") return;
    void studio()
      ?.terminal.status({ id: showcaseId })
      .then(({ running }) => setTermView(running ? "integrated" : "chooser"));
  }, [open, showcaseId, termView]);

  /* The integrated terminal docks as a full-height right sidebar; tell
   * the root layout to pad the content over. */
  const docked = open && Boolean(showcaseId);
  useEffect(() => {
    onDock?.(docked ? 640 : 0);
    return () => onDock?.(0);
  }, [docked, onDock]);

  /* The agent runs within a showcase — no button on the list pages. */
  if (!available || !showcaseId) return null;

  const restart = async () => {
    await studio()!.terminal.stop({ id: showcaseId });
    setTermExited(null);
    setTermSession((n) => n + 1);
    setTermView("integrated");
  };

  /* Minimize keeps the session running; close ends it. */
  const minimize = () => setOpen(false);
  const close = async () => {
    if (termView === "integrated") {
      await studio()!.terminal.stop({ id: showcaseId });
    }
    setTermExited(null);
    setTermView("loading");
    setOpen(false);
  };

  const openExternal = async () => {
    const result = await studio()!.terminal.external({ id: showcaseId });
    if (result.ok) setTermView("external");
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the studio agent"
        className="fixed bottom-6 right-6 z-50 rounded-full border border-border bg-card p-3.5 text-foreground shadow-lg transition-colors hover:bg-secondary"
      >
        <Sparkles className="size-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 top-0 z-50 flex w-[40rem] max-w-[100vw] flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="size-4 text-primary" /> Studio agent
          <span className="font-mono text-xs text-support">· {showcaseId}</span>
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void restart()}
            aria-label="Restart the session"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={minimize}
            aria-label="Minimize (the session keeps running)"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <Minus className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => void close()}
            aria-label="Close and end the session"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 p-1">
        {termView === "integrated" && (
          <TerminalPane
            key={`${showcaseId}:${termSession}`}
            sessionId={showcaseId}
            onExit={(code) => setTermExited(code)}
          />
        )}
        {termView === "chooser" && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <p className="text-xs text-support">
              Start Claude Code for <span className="font-mono">{showcaseId}</span> in:
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setTermView("integrated")}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <TerminalSquare className="size-4" /> Integrated terminal
              </button>
              <button
                type="button"
                onClick={() => void openExternal()}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
              >
                <ExternalLink className="size-4" /> External terminal
              </button>
            </div>
          </div>
        )}
        {termView === "external" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
            <p className="text-center text-xs leading-relaxed text-support">
              Claude Code for <span className="font-mono">{showcaseId}</span> is running in your
              system terminal.
            </p>
            <button
              type="button"
              onClick={() => setTermView("chooser")}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              Back
            </button>
          </div>
        )}
        {termExited != null && termView === "integrated" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80">
            <p className="flex items-center gap-2 text-sm text-support">
              <TerminalSquare className="size-4" /> Session ended (exit {termExited})
            </p>
            <button
              type="button"
              onClick={() => void restart()}
              className="rounded-full border border-border bg-card px-4 py-2 text-sm text-foreground transition-colors hover:bg-secondary"
            >
              Restart
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
