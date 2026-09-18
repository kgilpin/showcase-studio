/* How it works: a recording is the list of what a test run actually did,
 * and every change is compared with the baseline line by line — here the
 * new run makes an extra database query, so the recording is flagged.
 * Nothing smaller than 26 units, and no identifiers: the shape of the call
 * path is the point. Staged to the scene's caption windows (caption 1:
 * 0-8.2s, caption 2: 8.2-14.9s).
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const PINK = "var(--primary)";

const RECORDING = ["POST /project", "→ permission check", "→ update project", "→ 200 OK"];
const BASELINE = ["request", "permission check", "update project"];

function Recording({
  x,
  y,
  width,
  height,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={20}
        fill="var(--secondary)"
        stroke="var(--border)"
      />
      <text x={x + 28} y={y + 48} fill="var(--support)" fontSize={26}>
        one test run, recorded
      </text>
      {RECORDING.map((line, i) => (
        <text
          key={line}
          x={x + 28 + (i === 0 ? 0 : 24)}
          y={y + 108 + i * 52}
          fill={i === 0 ? "var(--foreground)" : "var(--muted-foreground)"}
          fontSize={i === 0 ? 32 : 30}
          fontWeight={i === 0 ? 600 : 400}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function Column({
  x,
  y,
  width,
  height,
  heading,
  extra = false,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  heading: string;
  extra?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={18}
        fill="var(--secondary)"
        stroke={extra ? PINK : "var(--border)"}
        strokeWidth={extra ? 3 : 1}
      />
      <text x={x + 24} y={y + 44} fill="var(--support)" fontSize={26}>
        {heading}
      </text>
      {BASELINE.map((line, i) => (
        <text key={line} x={x + 24} y={y + 100 + i * 48} fill="var(--foreground)" fontSize={28}>
          {line}
        </text>
      ))}
      {extra && (
        <text
          x={x + 24}
          y={y + 100 + BASELINE.length * 48}
          fill={PINK}
          fontSize={28}
          fontWeight={600}
        >
          + new query
        </text>
      )}
    </g>
  );
}

export default function Lifecycle() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtlc-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtlc-s1, .gtlc-s2, .gtlc-s3 { animation: gtlc-in 0.7s ease-out both; }
        .gtlc-s1 { animation-delay: 0.3s; }
        .gtlc-s2 { animation-delay: 8.4s; }
        .gtlc-s3 { animation-delay: 11.5s; }
        .gtlc-tall { display: block; }
        .gtlc-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtlc-tall { display: none; }
          .gtlc-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtlc-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtlc-arrow-w"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--support)" />
          </marker>
        </defs>

        <g className="gtlc-s1">
          <Recording x={40} y={40} width={520} height={330} />
        </g>

        <g className="gtlc-s2">
          <line
            x1="580"
            y1="200"
            x2="640"
            y2="200"
            stroke="var(--support)"
            strokeWidth="4"
            markerEnd="url(#gtlc-arrow-w)"
          />
          <Column x={660} y={40} width={280} height={330} heading="baseline, in git" />
          <Column x={960} y={40} width={280} height={330} heading="this change" extra />
        </g>

        <g className="gtlc-s3">
          <text x="660" y="440" fill={PINK} fontSize="32" fontWeight="600">
            one line differs → flagged for review
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtlc-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtlc-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--support)" />
          </marker>
        </defs>

        <g className="gtlc-s1">
          <Recording x={40} y={40} width={680} height={330} />
        </g>

        <g className="gtlc-s2">
          <line
            x1="380"
            y1="380"
            x2="380"
            y2="440"
            stroke="var(--support)"
            strokeWidth="4"
            markerEnd="url(#gtlc-arrow)"
          />
          <Column x={40} y={460} width={330} height={330} heading="baseline, in git" />
          <Column x={390} y={460} width={330} height={330} heading="this change" extra />
        </g>

        <g className="gtlc-s3">
          <text x="380" y="860" textAnchor="middle" fill={PINK} fontSize="32" fontWeight="600">
            one line differs → flagged
          </text>
        </g>
      </svg>
    </div>
  );
}
