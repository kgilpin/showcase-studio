/* Proof: what it looks like, and how much of the change has it. On the
 * left, the recorded path a test drives — the check runs and the stranger
 * is refused. On the right, the five operations the fix protects, with a
 * tick where a recorded test proves the new behavior and a cross where
 * nothing does. Nothing smaller than 26 units. Staged to the scene's
 * caption windows (caption 1: 0-8.3s, caption 2: 8.3-15s).
 * Source: goldtrace-examples, onlook-partial-authorization-check/REVIEW.md
 * (update and delete refusals recorded; addTag, removeTag and
 * captureScreenshot had no test).
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const RED = "#f87171";
const GREEN = "#34d399";

const PATH = ["request", "→ permission check", "→ refused"];
const OPERATIONS = [
  { label: "update", proven: true },
  { label: "delete", proven: true },
  { label: "tag", proven: false },
  { label: "untag", proven: false },
  { label: "shot", proven: false },
];

function Mark({ cx, cy, r, proven }: { cx: number; cy: number; r: number; proven: boolean }) {
  const color = proven ? GREEN : RED;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={3} />
      {proven ? (
        <polyline
          points={`${cx - r * 0.45},${cy} ${cx - r * 0.12},${cy + r * 0.38} ${cx + r * 0.5},${cy - r * 0.4}`}
          fill="none"
          stroke={color}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <g stroke={color} strokeWidth={5} strokeLinecap="round">
          <line x1={cx - r * 0.4} y1={cy - r * 0.4} x2={cx + r * 0.4} y2={cy + r * 0.4} />
          <line x1={cx + r * 0.4} y1={cy - r * 0.4} x2={cx - r * 0.4} y2={cy + r * 0.4} />
        </g>
      )}
    </g>
  );
}

/** The recorded path a test drives: what "proven" means. */
function ProvenPath({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={20} fill="var(--secondary)" stroke={GREEN} strokeWidth={2} strokeOpacity={0.6} />
      <text x={x + 28} y={y + 48} fill="var(--support)" fontSize={26}>
        what proof looks like
      </text>
      {PATH.map((line, i) => (
        <text
          key={line}
          x={x + 28 + (i === 0 ? 0 : 22)}
          y={y + 110 + i * 52}
          fill={i === PATH.length - 1 ? GREEN : "var(--foreground)"}
          fontSize={i === PATH.length - 1 ? 34 : 30}
          fontWeight={i === PATH.length - 1 ? 700 : 400}
        >
          {line}
        </text>
      ))}
      <Mark cx={x + width - 62} cy={y + height - 62} r={28} proven />
      <text x={x + 28} y={y + height - 40} fill="var(--support)" fontSize={26}>
        a recorded test drives it
      </text>
    </g>
  );
}

/** The five operations the fix protects, and which ones a test proves. */
function Coverage({ x, y, width, step }: { x: number; y: number; width: number; step: number }) {
  return (
    <g>
      <text x={x} y={y} fill="var(--support)" fontSize={26}>
        the 5 operations this change protects
      </text>
      {OPERATIONS.map((operation, i) => (
        <g key={operation.label}>
          <rect
            x={x + i * step}
            y={y + 26}
            width={step - 16}
            height={62}
            rx={12}
            fill="var(--secondary)"
            stroke={operation.proven ? GREEN : RED}
            strokeOpacity={0.5}
          />
          <text
            x={x + i * step + (step - 16) / 2}
            y={y + 66}
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize={26}
          >
            {operation.label}
          </text>
          <Mark cx={x + i * step + (step - 16) / 2} cy={y + 134} r={24} proven={operation.proven} />
        </g>
      ))}
      <text x={x} y={y + 216} fill="var(--foreground)" fontSize={32} fontWeight={600}>
        2 proven · 3 with no test
      </text>
    </g>
  );
}

export default function Proof() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtpf-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtpf-s1, .gtpf-s2, .gtpf-s3 { animation: gtpf-in 0.7s ease-out both; }
        .gtpf-s1 { animation-delay: 0.3s; }
        .gtpf-s2 { animation-delay: 8.5s; }
        .gtpf-s3 { animation-delay: 11.5s; }
        .gtpf-tall { display: block; }
        .gtpf-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtpf-tall { display: none; }
          .gtpf-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtpf-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtpf-s1">
          <ProvenPath x={40} y={50} width={520} height={330} />
        </g>
        <g className="gtpf-s2">
          <Coverage x={640} y={88} width={600} step={124} />
        </g>
        <g className="gtpf-s3">
          <text x="640" y="400" fill="var(--primary)" fontSize="30" fontWeight="600">
            the review names the 3 tests to add
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtpf-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtpf-s1">
          <ProvenPath x={40} y={50} width={680} height={340} />
        </g>
        <g className="gtpf-s2">
          <Coverage x={40} y={470} width={680} step={136} />
        </g>
        <g className="gtpf-s3">
          <text x="40" y="760" fill="var(--primary)" fontSize="30" fontWeight="600">
            the review names the 3 tests to add
          </text>
        </g>
      </svg>
    </div>
  );
}
