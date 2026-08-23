/* The embedded Claude Code session at work. Static transcript — the
 * cursor blink is the only motion. Condensed from a real session: asked
 * for a voiceover, it surveyed the machine, priced the options, and
 * wired the result into the showcase. */
export default function ClaudeTerminal() {
  const lines: [string, string][] = [
    ["$", " claude"],
    ["›", " Can we synthesize a voiceover for this showcase?"],
    ["✱", " Checking what's available on this machine…"],
    ["⏺", " found AWS Polly (neural voices) and macOS say"],
    ["✔", " Polly's voices sound real — this 180-word script costs under a cent."],
    ["✔", " I can synthesize it into assets/ and sync the captions word-for-word."],
    ["›", " Do it — then a draft export with the voiceover in."],
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
          width: "92cqw",
          borderRadius: "1.4cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "1cqw",
            padding: "1.5cqw 2cqw",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{
                width: "1.3cqw",
                height: "1.3cqw",
                borderRadius: "50%",
                background: "var(--border)",
              }}
            />
          ))}
          <span style={{ marginLeft: "1.2cqw", fontSize: "1.7cqw", color: "var(--support)" }}>
            claude — showcase-studio
          </span>
        </div>
        <div style={{ padding: "2.2cqw 2.6cqw" }}>
          {lines.map(([mark, text], i) => (
            <p key={i} style={{ fontSize: "2.4cqw", lineHeight: 1.75, whiteSpace: "pre-wrap" }}>
              <span style={{ color: colors[mark] }}>{mark}</span>
              <span style={{ color: "var(--foreground)" }}>{text}</span>
            </p>
          ))}
          <p style={{ fontSize: "2.4cqw", lineHeight: 1.75 }}>
            <span style={{ color: "var(--support)" }}>{"› "}</span>
            <span
              aria-hidden
              style={{
                display: "inline-block",
                width: "1.2cqw",
                height: "2.5cqw",
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
