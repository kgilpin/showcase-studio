/* One script, three renditions: showcase.yaml fanning out to the App
 * Store, TikTok, and YouTube canvases. Static — the arrows pulse, and
 * the resting state is the fully revealed diagram. */
export default function PlayerFormats() {
  const mono = "ui-monospace, Menlo, monospace";
  const label: React.CSSProperties = {
    marginTop: "1.6cqw",
    textAlign: "center",
    fontSize: "2.2cqw",
    fontFamily: mono,
    color: "var(--support)",
  };
  const frame: React.CSSProperties = {
    position: "relative",
    borderRadius: "1.4cqw",
    border: "1px solid var(--border)",
    background: "linear-gradient(160deg, var(--secondary, var(--card)) 0%, var(--card) 70%)",
    overflow: "hidden",
  };
  const block = (extra: React.CSSProperties): React.CSSProperties => ({
    position: "absolute",
    borderRadius: "0.6cqw",
    background: "var(--border)",
    ...extra,
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "3cqw",
        background: "var(--gradient-stage)",
      }}
    >
      <style>{`
        @keyframes fan-flow { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
      `}</style>
      {/* The one source. */}
      <div
        style={{
          width: "52cqw",
          borderRadius: "1.6cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "2.6cqw 3cqw",
          fontFamily: mono,
        }}
      >
        <p style={{ fontSize: "2.2cqw", color: "var(--support)", marginBottom: "1.4cqw" }}>
          showcase.yaml
        </p>
        <p style={{ fontSize: "2.3cqw", lineHeight: 1.8, color: "var(--primary)" }}>scenes:</p>
        <p
          style={{ fontSize: "2.3cqw", lineHeight: 1.8, color: "var(--foreground)", opacity: 0.7 }}
        >
          {"  - id: intro"}
        </p>
        <p
          style={{ fontSize: "2.3cqw", lineHeight: 1.8, color: "var(--foreground)", opacity: 0.7 }}
        >
          {"    captions: …"}
        </p>
      </div>
      {/* The fan. */}
      <div
        aria-hidden
        style={{
          display: "flex",
          gap: "12cqw",
          fontSize: "5cqw",
          lineHeight: 1,
          color: "var(--primary)",
          animation: "fan-flow 2.4s ease-in-out infinite",
        }}
      >
        <span style={{ display: "inline-block", transform: "rotate(45deg)" }}>↓</span>
        <span>↓</span>
        <span style={{ display: "inline-block", transform: "rotate(-45deg)" }}>↓</span>
      </div>
      {/* The three renditions. */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: "5cqw" }}>
        <div>
          {/* App Store: title above a phone-framed screen. */}
          <div style={{ ...frame, width: "19cqw", aspectRatio: "9 / 16" }}>
            <span style={block({ top: "7%", left: "20%", right: "20%", height: "4%" })} />
            <span
              style={block({
                top: "18%",
                left: "22%",
                right: "22%",
                bottom: "8%",
                borderRadius: "2cqw",
                background: "var(--background, rgb(8 11 20 / 0.5))",
                border: "1px solid var(--border)",
              })}
            />
          </div>
          <p style={label}>App Store</p>
        </div>
        <div>
          {/* TikTok: full-bleed media, caption chip low. */}
          <div style={{ ...frame, width: "19cqw", aspectRatio: "9 / 16" }}>
            <span
              style={block({
                top: "62%",
                left: "14%",
                right: "14%",
                height: "5%",
                background: "var(--primary)",
                opacity: 0.85,
              })}
            />
            <span
              style={block({
                top: "72%",
                left: "24%",
                right: "24%",
                height: "5%",
                background: "var(--primary)",
                opacity: 0.55,
              })}
            />
          </div>
          <p style={label}>TikTok</p>
        </div>
        <div>
          {/* YouTube 4:3: media panel with the text beside it. */}
          <div style={{ ...frame, width: "30cqw", aspectRatio: "4 / 3" }}>
            <span
              style={block({
                top: "12%",
                left: "8%",
                width: "48%",
                bottom: "12%",
                borderRadius: "1cqw",
                background: "var(--background, rgb(8 11 20 / 0.5))",
                border: "1px solid var(--border)",
              })}
            />
            <span style={block({ top: "30%", right: "10%", width: "26%", height: "5%" })} />
            <span style={block({ top: "42%", right: "10%", width: "22%", height: "5%" })} />
            <span style={block({ top: "54%", right: "10%", width: "24%", height: "5%" })} />
          </div>
          <p style={label}>YouTube 4:3</p>
        </div>
      </div>
    </div>
  );
}
