import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  ExternalLink,
  KeyRound,
  Minus,
  RotateCcw,
  Send,
  Sparkles,
  TerminalSquare,
  X,
} from "lucide-react";
import { studio, type AgentEvent } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { TerminalPane } from "./TerminalPane";

type Entry =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string };

type TermView = "loading" | "chooser" | "integrated" | "external";

/* The studio's agent panel, shown only inside a showcase (each showcase
 * has its own Claude session, running in that showcase's folder). Two
 * modes:
 *   - Claude Code: the user's own `claude`, integrated (persistent PTY,
 *     minimizable) or in the external system terminal. Sessions resume
 *     their previous conversation via `claude --continue`.
 *   - API key: the built-in BYOK chat agent, for users without Claude
 *     Code.
 * Renders nothing in a plain browser — the bridge only exists inside
 * Electron. */
export function StudioAgent({ onDock }: { onDock?: (px: number) => void }) {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"terminal" | "chat">("chat");
  const [terminalReady, setTerminalReady] = useState(false);
  const [termView, setTermView] = useState<TermView>("loading");
  const [termSession, setTermSession] = useState(1);
  const [termExited, setTermExited] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* Each showcase has its own persistent terminal session; the panel
   * shows the one for the showcase currently on screen. */
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

  /* Entering the terminal view: reattach if the session is running,
   * otherwise offer the integrated/external choice. */
  useEffect(() => {
    if (!open || mode !== "terminal" || !showcaseId || termView !== "loading") return;
    void studio()
      ?.terminal.status({ id: showcaseId })
      .then(({ running }) => setTermView(running ? "integrated" : "chooser"));
  }, [open, mode, showcaseId, termView]);

  useEffect(() => {
    const bridge = studio();
    if (!bridge?.agent) return;
    setAvailable(true);
    void bridge.agent.status().then(({ hasKey }) => setHasKey(hasKey));
    void bridge.terminal?.available().then(({ ptyReady, claude }) => {
      setTerminalReady(ptyReady);
      if (ptyReady && claude) setMode("terminal");
    });
    return bridge.agent.onEvent((event: AgentEvent) => {
      setEntries((prior) => {
        if (event.type === "text") {
          const last = prior.at(-1);
          if (last?.kind === "assistant") {
            return [...prior.slice(0, -1), { kind: "assistant", text: last.text + event.text }];
          }
          return [...prior, { kind: "assistant", text: event.text }];
        }
        if (event.type === "tool") {
          const detail =
            typeof event.input["path"] === "string"
              ? String(event.input["path"])
              : typeof event.input["showcaseId"] === "string"
                ? `${String(event.input["kind"] ?? "")} ${String(event.input["showcaseId"])}`
                : "";
          return [...prior, { kind: "tool", text: `${event.name} ${detail}`.trim() }];
        }
        if (event.type === "error") return [...prior, { kind: "error", text: event.message }];
        return prior;
      });
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  /* The integrated terminal docks as a full-height right sidebar; tell
   * the root layout to pad the content over. */
  const docked = open && mode === "terminal" && Boolean(showcaseId);
  useEffect(() => {
    onDock?.(docked ? 640 : 0);
    return () => onDock?.(0);
  }, [docked, onDock]);

  /* The agent runs within a showcase — no button on the list pages. */
  if (!available || !showcaseId) return null;

  const saveKey = async () => {
    setKeyError(null);
    const result = await studio()!.agent.setKey(keyInput.trim());
    if (result.ok) {
      setHasKey(true);
      setKeyInput("");
    } else {
      setKeyError(result.error ?? "Could not save the key");
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setEntries((prior) => [...prior, { kind: "user", text }]);
    setBusy(true);
    await studio()!.agent.send(text);
    setBusy(false);
  };

  const restart = async () => {
    if (mode === "terminal") {
      await studio()!.terminal.stop({ id: showcaseId });
      setTermExited(null);
      setTermSession((n) => n + 1);
      setTermView("integrated");
      return;
    }
    await studio()!.agent.reset();
    setEntries([]);
  };

  /* Minimize keeps the session running; close ends it. */
  const minimize = () => setOpen(false);
  const close = async () => {
    if (mode === "terminal" && termView === "integrated") {
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

  const tab = (id: "terminal" | "chat", label: string) => (
    <button
      type="button"
      onClick={() => setMode(id)}
      className={cn(
        "rounded-full px-3 py-1 text-xs transition-colors",
        mode === id ? "bg-card text-foreground" : "text-support hover:text-foreground",
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col bg-background",
        mode === "terminal"
          ? "bottom-0 right-0 top-0 w-[40rem] max-w-[100vw] border-l border-border"
          : "bottom-6 right-6 h-[32rem] w-[24rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-border shadow-2xl",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="size-4 text-primary" /> Studio agent
          {mode === "terminal" && (
            <span className="font-mono text-xs text-support">· {showcaseId}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {terminalReady && (
            <div className="flex items-center gap-1 rounded-full border border-border p-0.5">
              {tab("terminal", "Claude Code")}
              {tab("chat", "API key")}
            </div>
          )}
          <button
            type="button"
            onClick={() => void restart()}
            aria-label={mode === "terminal" ? "Restart the session" : "Start a new conversation"}
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

      {mode === "terminal" ? (
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
      ) : !hasKey ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-5">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <KeyRound className="size-4 text-primary" /> Bring your own key
          </p>
          <p className="text-xs leading-relaxed text-support">
            Paste an Anthropic API key to enable the agent. It is stored encrypted on this machine
            and only used to talk to the Claude API.
            {terminalReady &&
              " Or use the Claude Code tab to run your own subscription instead — no key needed."}
          </p>
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void saveKey()}
            placeholder="sk-ant-…"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-support/60"
          />
          {keyError && <p className="text-xs text-red-400">{keyError}</p>}
          <button
            type="button"
            onClick={() => void saveKey()}
            disabled={!keyInput.trim()}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            Save key
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {entries.length === 0 && (
              <p className="pt-6 text-center text-xs leading-relaxed text-support">
                Ask for showcase edits in plain language — “tighten the narration on slide 3”, “add
                a privacy slide”, “export the video”. Files change live.
              </p>
            )}
            {entries.map((entry, i) => (
              <div
                key={i}
                className={cn(
                  "text-sm leading-relaxed",
                  entry.kind === "user" && "ml-6 rounded-xl bg-card px-3 py-2 text-foreground",
                  entry.kind === "assistant" && "whitespace-pre-wrap text-muted-foreground",
                  entry.kind === "tool" && "font-mono text-xs text-primary/80",
                  entry.kind === "error" && "text-xs text-red-400",
                )}
              >
                {entry.kind === "tool" ? `→ ${entry.text}` : entry.text}
              </div>
            ))}
            {busy && <p className="text-xs text-support">working…</p>}
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="Ask the agent…"
              disabled={busy}
              className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none placeholder:text-support/60 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-full border border-border bg-card p-2.5 text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              <Send className="size-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
