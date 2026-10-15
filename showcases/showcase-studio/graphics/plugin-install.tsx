/* A terminal, stylized: the two commands that add the plugin type in one
 * after the other, each answered by a check line, and then a hint to type
 * /showcase in Claude Code.
 *
 * Captures render with animations turned off, so every element's plain
 * style is its FINAL state (both commands typed, every line shown); the
 * keyframes only describe the moments before that. */
export default function PluginInstall() {
  const mono = "ui-monospace, Menlo, monospace";
  /* Timed to the voiceover: the first command starts typing on "Add the
   * plugin to Claude Code" (the second caption starts 4.18 s in). */
  const FIRST = 4.4; // seconds: the first command starts typing
  const TYPE = 1.6; // seconds to type one command
  const SECOND = FIRST + TYPE + 0.5;
  const HINT = SECOND + TYPE + 0.6;
  const commands = [
    { text: "claude plugin marketplace add kgilpin/showcase-studio", at: FIRST },
    { text: "claude plugin install showcase-studio@showcase-studio", at: SECOND },
  ];
  const results = ["✓ Added marketplace showcase-studio", "✓ Installed showcase-studio"];
  const dot: React.CSSProperties = {
    width: "1.2cqw",
    height: "1.2cqw",
    borderRadius: "50%",
    background: "var(--border)",
  };
  const fadeIn = (delay: number): React.CSSProperties => ({
    animation: `pi-fade 0.3s ease-out ${delay}s both`,
  });
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
        @keyframes pi-type { from { width: 0; } }
        @keyframes pi-caret {
          0%, 99% { border-right-color: var(--primary); }
          100% { border-right-color: transparent; }
        }
        @keyframes pi-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @keyframes pi-fade { from { opacity: 0; transform: translateY(0.6cqw); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* The terminal window. */}
      <div
        style={{
          width: "92cqw",
          display: "flex",
          flexDirection: "column",
          borderRadius: "1.4cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
        }}
      >
        {/* Title bar. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1cqw",
            padding: "1.3cqw 2cqw",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <span style={dot} />
          <span style={dot} />
          <span style={dot} />
          <span
            style={{
              marginLeft: "1.2cqw",
              fontSize: "1.7cqw",
              fontFamily: mono,
              color: "var(--support)",
            }}
          >
            Terminal — my-app
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1.4cqw",
            padding: "3cqw 2.6cqw 3.4cqw",
            fontFamily: mono,
            fontSize: "2.2cqw",
            lineHeight: 1.3,
            color: "var(--foreground)",
          }}
        >
          {commands.map((c, i) => (
            <div key={c.text} style={{ display: "flex", flexDirection: "column", gap: "0.6cqw" }}>
              {/* The prompt, then the command typing in. */}
              <div style={{ display: "flex", whiteSpace: "nowrap", ...fadeIn(c.at - 0.3) }}>
                <span style={{ color: "var(--primary)", marginRight: "1ch" }}>$</span>
                <span
                  style={{
                    display: "inline-block",
                    overflow: "hidden",
                    borderRight: "0.25ch solid transparent",
                    animation: `pi-type ${TYPE}s steps(${c.text.length}) ${c.at}s both, pi-caret ${TYPE + 0.3}s linear ${c.at - 0.3}s both`,
                  }}
                >
                  {c.text}
                </span>
              </div>
              <div style={{ color: "var(--support)", ...fadeIn(c.at + TYPE + 0.2) }}>
                {results[i]}
              </div>
            </div>
          ))}

          {/* The next step, with the caret resting after it. */}
          <div style={{ display: "flex", whiteSpace: "nowrap", ...fadeIn(HINT) }}>
            <span style={{ color: "var(--support)" }}>
              # then type <span style={{ color: "var(--primary)" }}>/showcase</span> in Claude Code
            </span>
            <span
              style={{
                display: "inline-block",
                width: "0.6em",
                marginLeft: "0.6ch",
                background: "var(--primary)",
                animation: `pi-blink 1s step-end ${HINT}s infinite`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
