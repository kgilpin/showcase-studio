import { useEffect, useRef, useState } from "react";
import { KeyRound, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { studio, type AgentEvent } from "@/lib/studio";
import { cn } from "@/lib/utils";

type Entry =
  | { kind: "user" | "assistant"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string };

/* The studio's Claude agent panel: a floating chat that edits the
 * showcases folder through the shell. Renders nothing in a plain browser
 * — the bridge only exists inside Electron. */
export function StudioAgent() {
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
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

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[32rem] w-[24rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <Sparkles className="size-4 text-primary" /> Studio agent
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void reset()}
            aria-label="Start a new conversation"
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

      {!hasKey ? (
        <div className="flex flex-1 flex-col justify-center gap-3 px-5">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <KeyRound className="size-4 text-primary" /> Bring your own key
          </p>
          <p className="text-xs leading-relaxed text-support">
            Paste an Anthropic API key to enable the agent. It is stored encrypted on this machine
            and only used to talk to the Claude API.
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
