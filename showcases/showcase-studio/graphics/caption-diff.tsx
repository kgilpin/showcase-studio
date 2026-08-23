/* The whole concept in one picture: a one-line diff re-rendering the
 * slide. Resting state is fully revealed; the slide's caption chip
 * carries the + line. */
export default function CaptionDiff() {
  const context: [string, string][] = [
    ["  - id:", " otr"],
    ["    captions:", ""],
  ];
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
        fontFamily: "ui-monospace, Menlo, monospace",
      }}
    >
      <style>{`
        @keyframes flow { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
      `}</style>
      {/* The diff. */}
      <div
        style={{
          width: "80cqw",
          borderRadius: "2cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "3.4cqw 4cqw",
        }}
      >
        <p style={{ fontSize: "2.6cqw", color: "var(--support)", marginBottom: "2cqw" }}>
          git diff — showcase.yaml
        </p>
        {context.map(([key, value], i) => (
          <p key={i} style={{ fontSize: "2.65cqw", lineHeight: 1.8, whiteSpace: "pre", opacity: 0.6 }}>
            <span style={{ color: "var(--primary)" }}>{key}</span>
            <span style={{ color: "var(--foreground)" }}>{value}</span>
          </p>
        ))}
        <p
          style={{
            fontSize: "2.65cqw",
            lineHeight: 1.8,
            whiteSpace: "pre",
            color: "#f87171",
            background: "rgb(248 113 113 / 0.09)",
            borderRadius: "0.5cqw",
          }}
        >
          {"-     - text: Messages expire after ten minutes."}
        </p>
        <p
          style={{
            fontSize: "2.65cqw",
            lineHeight: 1.8,
            whiteSpace: "pre",
            color: "#4ade80",
            background: "rgb(74 222 128 / 0.10)",
            borderRadius: "0.5cqw",
          }}
        >
          {"+     - text: When you leave, it all disappears."}
        </p>
      </div>
      <div
        aria-hidden
        style={{
          fontSize: "6.5cqw",
          lineHeight: 1,
          color: "var(--primary)",
          animation: "flow 2.4s ease-in-out infinite",
        }}
      >
        ↓
      </div>
      {/* The re-rendered slide. */}
      <div
        style={{
          position: "relative",
          width: "42cqw",
          aspectRatio: "9 / 16",
          borderRadius: "2cqw",
          border: "1px solid var(--border)",
          background:
            "linear-gradient(160deg, var(--secondary, var(--card)) 0%, var(--card) 70%)",
          overflow: "hidden",
        }}
      >
        <p
          style={{
            position: "absolute",
            left: "8%",
            right: "8%",
            bottom: "18%",
            textAlign: "center",
            fontSize: "2.4cqw",
            lineHeight: 1.6,
            fontFamily: "inherit",
          }}
        >
          <span
            style={{
              color: "#fff",
              background: "rgb(8 11 20 / 0.72)",
              padding: "0.4cqw 0.9cqw",
              borderRadius: "0.5cqw",
              boxDecorationBreak: "clone",
              WebkitBoxDecorationBreak: "clone",
            }}
          >
            When you leave, it all disappears.
          </span>
        </p>
        <p
          style={{
            position: "absolute",
            top: "6%",
            width: "100%",
            textAlign: "center",
            fontSize: "1.8cqw",
            color: "var(--support)",
          }}
        >
          re-rendered
        </p>
      </div>
    </div>
  );
}
