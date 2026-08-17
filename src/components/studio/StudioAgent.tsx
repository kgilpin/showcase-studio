import { useEffect, useRef, useState } from "react";
import { KeyRound, RotateCcw, Send, Sparkles, TerminalSquare, X } from "lucide-react";
import { studio, type AgentEvent } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { TerminalPane } from "./TerminalPane";

type Entry =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string };

/* The studio's agent panel. Two modes:
 *   - Claude Code: an embedded terminal running the user's own `claude`
 *     in the showcases folder (subscription-billed; the seeded CLAUDE.md
 *     teaches it the showcase model). Default when installed.
 *   - API key: the built-in BYOK chat agent, for users without Claude
 *     Code.
 * Renders nothing in a plain browser — the bridge only exists inside
 * Electron. */
export function StudioAgent() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"terminal" | "chat">("chat");
  const [terminalReady, setTerminalReady] = useState(false);
  const [termSession, setTermSession] = useState(1);
  const [termExited, setTermExited] = useState<number | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  if (!available) return null;

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

  const reset = async () => {
    if (mode === "terminal") {
      setTermExited(null);
      setTermSession((n) => n + 1);
      return;
    }
    await studio()!.agent.reset();
    setEntries([]);
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
        "fixed bottom-6 right-6 z-50 flex max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl",
        mode === "terminal" ? "h-[32rem] w-[44rem]" : "h-[32rem] w-[24rem]",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="size-4 text-primary" /> Studio agent
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
            onClick={() => void reset()}
            aria-label={mode === "terminal" ? "Restart the session" : "Start a new conversation"}
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close the agent panel"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {mode === "terminal" ? (
        <div className="relative min-h-0 flex-1 p-1">
          <TerminalPane key={termSession} onExit={(code) => setTermExited(code)} />
          {termExited != null && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80">
              <p className="flex items-center gap-2 text-sm text-support">
                <TerminalSquare className="size-4" /> Session ended (exit {termExited})
              </p>
              <button
                type="button"
                onClick={() => void reset()}
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
