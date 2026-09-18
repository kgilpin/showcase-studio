/* Safe to adopt: what actually gets committed, and where it lives. First
 * the swap — a recorded value becomes a placeholder before the recording
 * is committed. Then the repository: the recordings sit beside the code,
 * and a laptop or CI runs against that same repo, with no service to sync
 * with. Nothing smaller than 26 units. Staged to the scene's caption
 * windows (caption 1: 0-8.8s, caption 2: 8.8-17.1s).
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
const GREEN = "#34d399";

/** The swap: what the code saw, and what the repository gets. */
function Swap({
  x,
  y,
  width,
  height,
  arrow,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  arrow: string;
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
      <text x={x + 28} y={y + 46} fill="var(--support)" fontSize={26}>
        recorded while the test ran
      </text>
      <text
        x={x + 28}
        y={y + 100}
        fill="var(--muted-foreground)"
        fontSize={28}
        fontFamily={MONO}
        textDecoration="line-through"
      >
        "dana@example.com"
      </text>
      <line
        x1={x + 60}
        y1={y + 124}
        x2={x + 60}
        y2={y + 168}
        stroke="var(--support)"
        strokeWidth={4}
        markerEnd={`url(#${arrow})`}
      />
      <text x={x + 96} y={y + 160} fill="var(--support)" fontSize={26}>
        swapped before it is committed
      </text>
      <text
        x={x + 28}
        y={y + 222}
        fill="var(--primary)"
        fontSize={32}
        fontFamily={MONO}
        fontWeight={600}
      >
        "&lt;v1&gt;"
      </text>
      <text x={x + 28} y={y + 268} fill="var(--support)" fontSize={26}>
        every value, in every recording
      </text>
    </g>
  );
}

/** Where the recordings live, and what runs against them. */
function Repo({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={20}
        fill="var(--secondary)"
        stroke="var(--primary)"
        strokeWidth={3}
      />
      <text x={x + 28} y={y + 46} fill="var(--support)" fontSize={26}>
        your Git repository
      </text>
      <text x={x + 28} y={y + 108} fill="var(--foreground)" fontSize={32} fontFamily={MONO}>
        src/
      </text>
      <text
        x={x + 28}
        y={y + 160}
        fill="var(--primary)"
        fontSize={32}
        fontFamily={MONO}
        fontWeight={600}
      >
        gold_traces/
      </text>
      <text x={x + 28} y={y + 206} fill="var(--support)" fontSize={26}>
        reviewed with the code, in the same pull request
      </text>
    </g>
  );
}

function Runner({ x, y, width, label }: { x: number; y: number; width: number; label: string }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={70}
        rx={35}
        fill="var(--muted)"
        stroke={GREEN}
        strokeOpacity={0.6}
        strokeWidth={2}
      />
      <text
        x={x + width / 2}
        y={y + 46}
        textAnchor="middle"
        fill={GREEN}
        fontSize={28}
        fontWeight={600}
      >
        {label}
      </text>
    </g>
  );
}

export default function Safe() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtsf-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtsf-s1, .gtsf-s2, .gtsf-s3 { animation: gtsf-in 0.7s ease-out both; }
        .gtsf-s1 { animation-delay: 0.3s; }
        .gtsf-s2 { animation-delay: 8.9s; }
        .gtsf-s3 { animation-delay: 12.5s; }
        .gtsf-tall { display: block; }
        .gtsf-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtsf-tall { display: none; }
          .gtsf-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtsf-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtsf-arrow-w"
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

        <g className="gtsf-s1">
          <Swap x={40} y={50} width={560} height={310} arrow="gtsf-arrow-w" />
        </g>
        <g className="gtsf-s2">
          <Repo x={680} y={50} width={560} height={250} />
        </g>
        <g className="gtsf-s3">
          <Runner x={680} y={334} width={260} label="runs on a laptop" />
          <Runner x={980} y={334} width={260} label="or in CI" />
          <text x="680" y="440" fill="var(--support)" fontSize="26">
            no service to sync with
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtsf-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtsf-arrow-t"
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

        <g className="gtsf-s1">
          <Swap x={40} y={50} width={680} height={310} arrow="gtsf-arrow-t" />
        </g>
        <g className="gtsf-s2">
          <Repo x={40} y={420} width={680} height={250} />
        </g>
        <g className="gtsf-s3">
          <Runner x={40} y={706} width={320} label="runs on a laptop" />
          <Runner x={400} y={706} width={320} label="or in CI" />
          <text x="40" y="828" fill="var(--support)" fontSize="26">
            no service to sync with
          </text>
        </g>
      </svg>
    </div>
  );
}
