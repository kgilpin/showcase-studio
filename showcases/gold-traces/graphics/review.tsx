/* The review: three findings, ranked, and a blocked merge with the fix.
 * One idea, big type — nothing smaller than 26 units. Staged to the
 * scene's caption windows (caption 1: 0-8.4s, caption 2: 8.4-17.9s).
 * Severities and wording follow the real review, shortened.
 * Source: goldtrace-examples, onlook-partial-authorization-check/REVIEW.md.
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const RED = "#f87171";
const AMBER = "#fbbf24";
const GREEN = "#34d399";

const FINDINGS = [
  { severity: "HIGH", color: RED, title: "a stranger can still get in" },
  { severity: "MEDIUM", color: AMBER, title: "a refusal looks like a crash" },
  { severity: "LOW", color: GREEN, title: "the check reads too much" },
];

function Finding({ x, y, width, index }: { x: number; y: number; width: number; index: number }) {
  const { severity, color, title } = FINDINGS[index]!;
  return (
    <g>
      <rect x={x} y={y} width={width} height={86} rx={16} fill="var(--secondary)" />
      <rect x={x + 20} y={y + 20} width={168} height={46} rx={23} fill={color} />
      <text
        x={x + 104}
        y={y + 52}
        textAnchor="middle"
        fill="#0d0a1a"
        fontSize={26}
        fontWeight={700}
      >
        {severity}
      </text>
      <text x={x + 212} y={y + 54} fill="var(--foreground)" fontSize={30}>
        {title}
      </text>
    </g>
  );
}

function Blocked({ x, y, width }: { x: number; y: number; width: number }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={104}
        rx={20}
        fill={RED}
        fillOpacity={0.16}
        stroke={RED}
        strokeWidth={3}
      />
      <text
        x={x + width / 2}
        y={y + 68}
        textAnchor="middle"
        fill={RED}
        fontSize={44}
        fontWeight={700}
      >
        Merge blocked
      </text>
    </g>
  );
}

export default function Review() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtrv-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtrv-s1, .gtrv-s2 { animation: gtrv-in 0.7s ease-out both; }
        .gtrv-s1 { animation-delay: 0.3s; }
        .gtrv-s2 { animation-delay: 8.6s; }
        .gtrv-tall { display: block; }
        .gtrv-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtrv-tall { display: none; }
          .gtrv-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtrv-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtrv-s1">
          {FINDINGS.map((finding, i) => (
            <Finding key={finding.severity} x={40} y={60 + i * 104} width={600} index={i} />
          ))}
        </g>
        <g className="gtrv-s2">
          <Blocked x={680} y={60} width={560} />
          <text x="680" y="230" fill="var(--primary)" fontSize="28" fontWeight="600">
            The fix
          </text>
          <text x="680" y="280" fill="var(--foreground)" fontSize="30">
            One permission check
          </text>
          <text x="680" y="322" fill="var(--foreground)" fontSize="30">
            on every operation.
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtrv-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtrv-s1">
          {FINDINGS.map((finding, i) => (
            <Finding key={finding.severity} x={40} y={90 + i * 110} width={680} index={i} />
          ))}
        </g>
        <g className="gtrv-s2">
          <Blocked x={40} y={480} width={680} />
          <text x="40" y="660" fill="var(--primary)" fontSize="28" fontWeight="600">
            The fix
          </text>
          <text x="40" y="712" fill="var(--foreground)" fontSize="32">
            One permission check
          </text>
          <text x="40" y="758" fill="var(--foreground)" fontSize="32">
            on every operation.
          </text>
        </g>
      </svg>
    </div>
  );
}
