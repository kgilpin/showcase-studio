/* One YAML source flowing into three renditions. Portrait-first: the
 * file on top, the outputs fanned below. Resting state is the fully
 * revealed diagram; the arrow pulse is decorative only. */
export default function YamlPipeline() {
  const yamlLines: [string, string][] = [
    ["meta:", ""],
    ["  title:", " NOVA"],
    ["scenes:", ""],
    ["  - id:", " intro"],
    ["    theme:", " statement"],
    ["    captions:", ""],
    ["      - text:", " A real-time game"],
    ["    media:", ""],
    ["      asset:", " nova-mark"],
  ];
  const outputs = [
    ["App Store", "screenshots"],
    ["TikTok", "9:16 video"],
    ["YouTube", "4:3 embed"],
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
      <div
        style={{
          width: "68cqw",
          borderRadius: "2cqw",
          border: "1px solid var(--border)",
          background: "var(--card)",
          padding: "4cqw",
        }}
      >
        <p style={{ fontSize: "3cqw", color: "var(--support)", marginBottom: "2.4cqw" }}>
          showcase.yaml
        </p>
        {yamlLines.map(([key, value], i) => (
          <p key={i} style={{ fontSize: "3.2cqw", lineHeight: 1.75, whiteSpace: "pre" }}>
            <span style={{ color: "var(--primary)" }}>{key}</span>
            <span style={{ color: "var(--foreground)" }}>{value}</span>
          </p>
        ))}
      </div>
      <div
        aria-hidden
        style={{
          fontSize: "7cqw",
          lineHeight: 1,
          color: "var(--primary)",
          animation: "flow 2.4s ease-in-out infinite",
        }}
      >
        ↓
      </div>
      <div style={{ display: "flex", gap: "2.4cqw" }}>
        {outputs.map(([name, kind]) => (
          <div
            key={name}
            style={{
              width: "27cqw",
              borderRadius: "1.6cqw",
              border: "1px solid var(--border)",
              background: "var(--card)",
              padding: "2.6cqw 2.8cqw",
            }}
          >
            <p style={{ fontSize: "3.1cqw", color: "var(--foreground)" }}>{name}</p>
            <p style={{ fontSize: "2.4cqw", color: "var(--support)", marginTop: "0.8cqw" }}>
              {kind}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
