/* Risk: what each safeguard checks, and the gap none of them covers.
 * Tests check what you thought to test; code review checks what the diff
 * says; nothing checks what the change does when it runs. One idea, big
 * type — nothing smaller than 26 units. Staged to the narration: tests
 * (0s), code review (the second sentence, ~3s), and the gap (caption 2,
 * 6.25s).
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const GREEN = "#34d399";

const CHECKED = [
  { who: "Tests", what: "what you thought to test" },
  { who: "Code review", what: "what the diff says" },
];

function Tick({ cx, cy }: { cx: number; cy: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={26} fill={GREEN} fillOpacity={0.16} stroke={GREEN} strokeWidth={3} />
      <polyline
        points={`${cx - 12},${cy} ${cx - 3},${cy + 10} ${cx + 13},${cy - 10}`}
        fill="none"
        stroke={GREEN}
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Checked({ x, y, width, index }: { x: number; y: number; width: number; index: number }) {
  const row = CHECKED[index];
  return (
    <g>
      <rect x={x} y={y} width={width} height={150} rx={20} fill="var(--muted)" />
      <text x={x + 32} y={y + 60} fill="var(--support)" fontSize={30}>
        {row.who} check
      </text>
      <text x={x + 32} y={y + 114} fill="var(--foreground)" fontSize={40} fontWeight={600}>
        {row.what}
      </text>
      <Tick cx={x + width - 58} cy={y + 75} />
    </g>
  );
}

/** The gap. `lines` splits the runtime claim to fit a narrow panel. */
function Gap({ x, y, width, lines }: { x: number; y: number; width: number; lines: string[] }) {
  const height = 110 + lines.length * 52;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={20}
        fill="var(--primary)"
        fillOpacity={0.08}
        stroke="var(--primary)"
        strokeWidth={3}
        strokeDasharray="14 10"
      />
      <text x={x + 32} y={y + 62} fill="var(--support)" fontSize={30}>
        Nothing checks
      </text>
      {lines.map((line, i) => (
        <text key={line} x={x + 32} y={y + 120 + i * 52} fill="var(--foreground)" fontSize={40} fontWeight={700}>
          {line}
        </text>
      ))}
      <text
        x={x + width - 62}
        y={y + height / 2 + 30}
        textAnchor="middle"
        fill="var(--primary)"
        fontSize={88}
        fontWeight={800}
        fontFamily="var(--font-display)"
      >
        ?
      </text>
    </g>
  );
}

export default function Risk() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtrk-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes gtrk-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.55; }
        }
        .gtrk-s1, .gtrk-s2, .gtrk-s3 { animation: gtrk-in 0.7s ease-out both; }
        .gtrk-s1 { animation-delay: 0.3s; }
        .gtrk-s2 { animation-delay: 3.1s; }
        .gtrk-s3 { animation-delay: 6.4s; }
        .gtrk-q { animation: gtrk-pulse 1.6s ease-in-out 7.4s 2 both; }
        .gtrk-tall { display: block; }
        .gtrk-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtrk-tall { display: none; }
          .gtrk-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtrk-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtrk-s1">
          <Checked x={40} y={20} width={1200} index={0} />
        </g>
        <g className="gtrk-s2">
          <Checked x={40} y={186} width={1200} index={1} />
        </g>
        <g className="gtrk-s3">
          <g className="gtrk-q">
            <Gap x={40} y={372} width={1200} lines={["what the change does when it runs"]} />
          </g>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtrk-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <g className="gtrk-s1">
          <Checked x={40} y={178} width={680} index={0} />
        </g>
        <g className="gtrk-s2">
          <Checked x={40} y={358} width={680} index={1} />
        </g>
        <g className="gtrk-s3">
          <g className="gtrk-q">
            <Gap x={40} y={558} width={680} lines={["what the change does", "when it runs"]} />
          </g>
        </g>
      </svg>
    </div>
  );
}
