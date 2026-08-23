/* The embedded Claude Code session at work. Static transcript — the
 * cursor blink is the only motion. */
export default function ClaudeTerminal() {
  const lines: [string, string][] = [
    ["$", " claude"],
    ["›", " Tighten the hook and check the slide"],
    ["✱", " Editing showcase.yaml — trimming the opening caption…"],
    ["⏺", " screenshot_slide(intro) → looks right"],
    ["⏺", " transcribe(voiceover.mp3) → 21 segments, word timestamps"],
    ["⏺", " export video-draft → done in 74s"],
    ["✔", " Draft is in Downloads — the hook lands two seconds sooner."],
  ];
  const colors: Record<string, string> = {
    $: "var(--support)",
    "›": "var(--primary)",
    "✱": "var(--accent, var(--primary))",
    "⏺": "var(--support)",
    "✔": "var(--primary)",
  };
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--gradient-stage)",
      }}
    >
      <style>{`
        @keyframes cursor-blink { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }
      `}</style>
      <div
        style={{
          width: "72cqw",
          borderRadius: "1.2cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "0.8cqw",
            padding: "1.2cqw 1.6cqw",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: "1cqw",
                height: "1cqw",
                borderRadius: "50%",
                background: "var(--border)",
              }}
            />
          ))}
          <span style={{ marginLeft: "1cqw", fontSize: "1.3cqw", color: "var(--support)" }}>
            claude — nova
          </span>
        </div>
        <div style={{ padding: "1.8cqw 2cqw" }}>
          {lines.map(([mark, text], i) => (
            <p key={i} style={{ fontSize: "1.8cqw", lineHeight: 1.9, whiteSpace: "pre-wrap" }}>
              <span style={{ color: colors[mark] }}>{mark}</span>
              <span style={{ color: "var(--foreground)" }}>{text}</span>
            </p>
          ))}
          <p style={{ fontSize: "1.8cqw", lineHeight: 1.9 }}>
            <span style={{ color: "var(--support)" }}>{"› "}</span>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: "0.9cqw",
                height: "1.9cqw",
                verticalAlign: "text-bottom",
                background: "var(--foreground)",
                animation: "cursor-blink 1.1s step-end infinite",
              }}
            />
          </p>
        </div>
      </div>
    </div>
  );
}
