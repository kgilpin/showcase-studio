/* A two-lane commit graph: the showcase folder behaving like code.
 * SVG rails and dots in a fixed left column, messages beside. */
export default function GitLanes() {
  const commits: { lane: 0 | 1; message: string }[] = [
    { lane: 0, message: "Add the launch showcase" },
    { lane: 0, message: "Swap privacy screenshot" },
    { lane: 1, message: "tighten the hook" },
    { lane: 1, message: "retime to voiceover" },
    { lane: 0, message: "Merge new-cut — 12s shorter" },
  ];
  const rowH = 44;
  const laneX = [16, 48];
  const height = commits.length * rowH;
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
      <div
        style={{
          width: "78cqw",
          borderRadius: "2cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "4cqw",
          fontFamily: "ui-monospace, Menlo, monospace",
        }}
      >
        <p style={{ fontSize: "2.8cqw", color: "var(--support)", marginBottom: "1cqw" }}>
          showcases/ — git log --graph
        </p>
        <p style={{ fontSize: "2.3cqw", color: "var(--support)", marginBottom: "2cqw" }}>
          <span style={{ color: "var(--primary)" }}>●</span> main{"   "}
          <span style={{ color: "var(--primary)" }}>○</span> new-cut
        </p>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <svg
            viewBox={`0 0 64 ${height}`}
            style={{ width: "11cqw", height: `${(height / 64) * 11}cqw`, flexShrink: 0 }}
            aria-hidden
          >
            <line
              x1={laneX[0]}
              y1="10"
              x2={laneX[0]}
              y2={height - 10}
              stroke="var(--border)"
              strokeWidth="3"
            />
            <line
              x1={laneX[1]}
              y1={rowH * 1.5}
              x2={laneX[1]}
              y2={rowH * 3.5}
              stroke="var(--border)"
              strokeWidth="3"
            />
            {/* branch + merge elbows */}
            <path
              d={`M ${laneX[0]} ${rowH * 1.5} Q ${laneX[1]} ${rowH * 1.5} ${laneX[1]} ${rowH * 2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth="3"
            />
            <path
              d={`M ${laneX[1]} ${rowH * 3.5} Q ${laneX[1]} ${rowH * 4.4} ${laneX[0]} ${rowH * 4.5}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth="3"
            />
            {commits.map((commit, i) => (
              <circle
                key={i}
                cx={laneX[commit.lane]}
                cy={rowH * i + rowH / 2}
                r="8"
                fill={commit.lane === 0 ? "var(--primary)" : "var(--card)"}
                stroke="var(--primary)"
                strokeWidth="3"
              />
            ))}
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            {commits.map((commit, i) => (
              <p
                key={i}
                style={{
                  height: `${(rowH / 64) * 11}cqw`,
                  display: "flex",
                  alignItems: "center",
                  fontSize: "3cqw",
                  color: commit.lane === 0 ? "var(--foreground)" : "var(--muted-foreground)",
                  whiteSpace: "nowrap",
                }}
              >
                {commit.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
