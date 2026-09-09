/* The concept in one picture: the YAML for this very slide, straight
 * from showcase.yaml, syntax-lit. Resting state is fully revealed; the
 * only motion is the cursor at the end of the file. */
export default function SceneYaml() {
  // [indent, key, value] — value "" renders a bare key; key "" renders a
  // continuation line of the previous scalar.
  const lines: [number, string, string][] = [
    [2, "- id:", " yaml"],
    [4, "theme:", " console"],
    [4, "title:", " Change one word. Ship a new video."],
    [4, "captions:", ""],
    [6, "- text:", " Under the hood, the video is"],
    [14, "", "stored as a YAML file in your repo."],
    [6, "- text:", " Change a line or swap a screenshot,"],
    [14, "", "and the video re-renders."],
    [4, "media:", ""],
    [6, "kind:", " graphic"],
    [6, "graphic:", " scene-yaml"],
  ];
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--gradient-stage)",
        fontFamily: "ui-monospace, Menlo, monospace",
      }}
    >
      <style>{`
        @keyframes cursor-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
      `}</style>
      <div
        style={{
          width: "86cqw",
          borderRadius: "2cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.2cqw",
            padding: "1.5cqw 2.4cqw",
            borderBottom: "1px solid var(--border)",
            fontSize: "2cqw",
            color: "var(--support)",
          }}
        >
          <span aria-hidden style={{ display: "inline-flex", gap: "0.7cqw" }}>
            {[0, 1, 2].map((i) => (
              <i
                key={i}
                style={{
                  width: "1.2cqw",
                  height: "1.2cqw",
                  borderRadius: "50%",
                  background: "var(--border)",
                }}
              />
            ))}
          </span>
          showcases/showcase-studio/showcase.yaml
        </div>
        <div style={{ padding: "2cqw 2.8cqw 2.2cqw" }}>
          {lines.map(([indent, key, value], i) => (
            <p
              key={i}
              style={{
                fontSize: "2.55cqw",
                lineHeight: 1.7,
                whiteSpace: "pre",
                margin: 0,
              }}
            >
              <span style={{ color: "var(--muted-foreground, var(--support))", opacity: 0.5 }}>
                {String(i + 1).padStart(2, " ")}
                {"  "}
              </span>
              {" ".repeat(indent)}
              <span style={{ color: "var(--primary)" }}>{key}</span>
              <span style={{ color: "var(--foreground)" }}>{value}</span>
              {i === lines.length - 1 && (
                <span
                  aria-hidden
                  style={{
                    display: "inline-block",
                    width: "0.55em",
                    height: "1.05em",
                    verticalAlign: "text-bottom",
                    marginLeft: "0.15em",
                    background: "var(--foreground)",
                    animation: "cursor-blink 1.1s step-end infinite",
                  }}
                />
              )}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
