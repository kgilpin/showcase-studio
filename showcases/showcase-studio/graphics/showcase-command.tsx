/* Claude Code Desktop, stylized: "/showcase" types into the input box and
 * is sent into the chat history, Claude calls studio_start (the dot pulses
 * while it works), the result comes back, the studio slides open in the
 * Browser pane, and Claude replies.
 *
 * Captures render with animations turned off, so every element's plain
 * style is its FINAL state (input empty, message in the history); the
 * keyframes only describe the moments before that. */
export default function ShowcaseCommand() {
  const mono = "ui-monospace, Menlo, monospace";
  /* Timed to the voiceover: "Type /showcase" is spoken while it types, and
   * the pane opens on "the studio opens" (about 2 s into the scene). */
  const SEND = 1.1; // seconds: the moment the message is sent
  const bar = (width: string, opacity = 1): React.CSSProperties => ({
    display: "block",
    height: "1.1cqw",
    width,
    borderRadius: "0.55cqw",
    background: "var(--border)",
    opacity,
  });
  const dot: React.CSSProperties = {
    width: "1.2cqw",
    height: "1.2cqw",
    borderRadius: "50%",
    background: "var(--border)",
  };
  const fadeIn = (delay: number): React.CSSProperties => ({
    animation: `sc-fade 0.4s ease-out ${delay}s both`,
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
        @keyframes sc-type { from { width: 0; } to { width: 9ch; } }
        @keyframes sc-show-until-end { from { opacity: 1; } to { opacity: 0; } }
        @keyframes sc-hide-until-end { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sc-blink { 0%, 45% { opacity: 1; } 55%, 100% { opacity: 0; } }
        @keyframes sc-fade { from { opacity: 0; transform: translateY(0.8cqw); } to { opacity: 1; transform: none; } }
        @keyframes sc-work { from { opacity: 0.25; } to { opacity: 1; } }
        @keyframes sc-open { from { opacity: 0; transform: translateX(8cqw); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* The desktop window. */}
      <div
        style={{
          width: "94cqw",
          aspectRatio: "16 / 9.5",
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
            Claude Code — my-app
          </span>
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* Chat column. */}
          <div
            style={{
              width: "42%",
              display: "flex",
              flexDirection: "column",
              gap: "1.6cqw",
              padding: "2.4cqw 2.2cqw",
              borderRight: "1px solid var(--border)",
            }}
          >
            {/* An earlier reply. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9cqw" }}>
              <span style={bar("90%", 0.7)} />
              <span style={bar("76%", 0.7)} />
              <span style={bar("58%", 0.7)} />
            </div>

            {/* The sent command, in the history. */}
            <div
              style={{
                alignSelf: "flex-end",
                padding: "1.1cqw 1.6cqw",
                borderRadius: "1.2cqw",
                background: "var(--secondary, var(--border))",
                fontFamily: mono,
                fontSize: "2.6cqw",
                color: "var(--foreground)",
                ...fadeIn(SEND),
              }}
            >
              /showcase
            </div>

            {/* Claude works: the tool call, then its result. */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "0.7cqw", fontFamily: mono }}
            >
              <p style={{ fontSize: "2cqw", color: "var(--foreground)", ...fadeIn(SEND + 0.3) }}>
                <span
                  style={{
                    color: "var(--primary)",
                    display: "inline-block",
                    animation: `sc-work 0.25s ease-in-out ${SEND + 0.3}s 3 alternate both`,
                  }}
                >
                  ●
                </span>{" "}
                studio_start
              </p>
              <p style={{ fontSize: "1.8cqw", color: "var(--support)", ...fadeIn(SEND + 0.8) }}>
                {"  ⎿ Studio running"}
              </p>
            </div>

            {/* Claude's reply. */}
            <p
              style={{
                fontSize: "2.2cqw",
                lineHeight: 1.4,
                color: "var(--foreground)",
                ...fadeIn(SEND + 1.5),
              }}
            >
              The studio is open. Which scene should we start with?
            </p>

            <div style={{ flex: 1 }} />

            {/* Input box: "/showcase" is typed here, then sent. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "1.2cqw 1.6cqw",
                borderRadius: "1.2cqw",
                border: "1px solid var(--border)",
                minHeight: "5.4cqw",
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: "0.3cqw",
                  height: "2.4cqw",
                  marginRight: "0.8cqw",
                  background: "var(--primary)",
                  animation: "sc-blink 1.1s step-end infinite",
                }}
              />
              <span
                style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}
              >
                {/* Placeholder: hidden while typing, back once sent. */}
                <span
                  style={{
                    fontSize: "1.9cqw",
                    color: "var(--muted-foreground, var(--support))",
                    animation: `sc-hide-until-end ${SEND}s step-end both`,
                  }}
                >
                  Reply…
                </span>
                {/* Typed text: gone once sent (plain style is hidden). */}
                <span
                  style={{
                    position: "absolute",
                    left: 0,
                    opacity: 0,
                    animation: `sc-show-until-end ${SEND}s step-end both`,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      width: "9ch",
                      fontFamily: mono,
                      fontSize: "2.4cqw",
                      color: "var(--foreground)",
                      animation: "sc-type 0.7s steps(9) 0.2s both",
                    }}
                  >
                    /showcase
                  </span>
                </span>
              </span>
            </div>
          </div>

          {/* Browser pane with the studio. */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              animation: `sc-open 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) ${SEND + 1.0}s both`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1cqw",
                padding: "1.1cqw 1.6cqw",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: "1.8cqw", color: "var(--support)" }}>‹ ›</span>
              <span
                style={{
                  flex: 1,
                  padding: "0.6cqw 1.2cqw",
                  borderRadius: "1cqw",
                  border: "1px solid var(--border)",
                  fontFamily: mono,
                  fontSize: "1.6cqw",
                  color: "var(--support)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                }}
              >
                localhost/showcase/my-app
              </span>
            </div>

            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "1.8cqw",
                background: "var(--background, rgb(8 11 20 / 0.5))",
              }}
            >
              {/* A slide in the player. */}
              <div
                style={{
                  position: "relative",
                  height: "27cqw",
                  aspectRatio: "9 / 19.5",
                  borderRadius: "2cqw",
                  border: "1px solid var(--border)",
                  background: "var(--card)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: "9%",
                    left: "18%",
                    right: "18%",
                    height: "4.5%",
                    borderRadius: "0.5cqw",
                    background: "var(--foreground)",
                    opacity: 0.8,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: "21%",
                    left: "12%",
                    right: "12%",
                    height: "42%",
                    borderRadius: "1cqw",
                    background: "var(--gradient-accent, var(--primary))",
                    opacity: 0.85,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: "72%",
                    left: "16%",
                    right: "16%",
                    height: "5%",
                    borderRadius: "0.5cqw",
                    background: "var(--primary)",
                    opacity: 0.7,
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    top: "80%",
                    left: "26%",
                    right: "26%",
                    height: "5%",
                    borderRadius: "0.5cqw",
                    background: "var(--primary)",
                    opacity: 0.45,
                  }}
                />
              </div>

              {/* Timeline. */}
              <div style={{ display: "flex", gap: "0.7cqw" }}>
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: "3.4cqw",
                      height: "0.8cqw",
                      borderRadius: "0.4cqw",
                      background: i < 3 ? "var(--primary)" : "var(--border)",
                    }}
                  />
                ))}
              </div>

              {/* Controls. */}
              <div style={{ display: "flex", alignItems: "center", gap: "1.4cqw" }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: i === 1 ? "4cqw" : "3cqw",
                      height: i === 1 ? "4cqw" : "3cqw",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.8cqw",
                      color: "var(--primary-foreground, white)",
                      background: i === 1 ? "var(--primary)" : "transparent",
                      border: i === 1 ? "none" : "1px solid var(--border)",
                    }}
                  >
                    {i === 1 ? "▶" : ""}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
