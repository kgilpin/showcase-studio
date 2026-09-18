/* The hook: Onlook's security fix passed everything, fixed five of about
 * forty-five operations, and left the rest open for seven months. One idea,
 * big type: nothing here is smaller than 26 units, so it stays readable on
 * a phone. Staged to the scene's caption windows (caption 1: 0-6.8s,
 * caption 2: 6.8-14.4s). The voiceover never names Onlook — this does.
 * Source: github.com/evlawler/goldtrace-examples, onlook-partial-authorization-check.
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const RED = "#f87171";
const GREEN = "#34d399";

/* 45 operations take a project id: the fix protected 5. */
const OPERATIONS = Array.from({ length: 45 }, (_, i) => i < 5);

function Passed({ x, y, width, label }: { x: number; y: number; width: number; label: string }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={76} rx={38} fill={GREEN} fillOpacity={0.14} stroke={GREEN} strokeWidth={2} />
      <text x={x + width / 2} y={y + 50} textAnchor="middle" fill={GREEN} fontSize={34} fontWeight={600}>
        ✓ {label}
      </text>
    </g>
  );
}

function Grid({ x, y, size, gap }: { x: number; y: number; size: number; gap: number }) {
  return (
    <g>
      {OPERATIONS.map((fixed, i) => (
        <rect
          key={i}
          x={x + (i % 9) * (size + gap)}
          y={y + Math.floor(i / 9) * (size + gap)}
          width={size}
          height={size}
          rx={8}
          fill={fixed ? GREEN : RED}
          fillOpacity={fixed ? 0.9 : 0.14}
          stroke={fixed ? GREEN : RED}
          strokeWidth={2}
        />
      ))}
    </g>
  );
}

function Legend({ x, y, size, gap }: { x: number; y: number; size: number; gap: number }) {
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={5} fill={GREEN} />
      <text x={x + size + 12} y={y + size - 4} fill={GREEN} fontSize={30} fontWeight={600}>
        5 fixed
      </text>
      <rect x={x + gap} y={y} width={size} height={size} rx={5} fill={RED} fillOpacity={0.14} stroke={RED} strokeWidth={2} />
      <text x={x + gap + size + 12} y={y + size - 4} fill={RED} fontSize={30} fontWeight={600}>
        40 still open
      </text>
    </g>
  );
}

export default function Hook() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gthk-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gthk-s1, .gthk-s2, .gthk-s3 { animation: gthk-in 0.7s ease-out both; }
        .gthk-s1 { animation-delay: 0.3s; }
        .gthk-s2 { animation-delay: 7s; }
        .gthk-s3 { animation-delay: 10.5s; }
        .gthk-tall { display: block; }
        .gthk-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gthk-tall { display: none; }
          .gthk-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gthk-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Stage 1: the change everyone signed off on */}
        <g className="gthk-s1">
          <text x="40" y="60" fill="var(--support)" fontSize="30">
            Onlook · security fix
          </text>
          <Passed x={40} y={92} width={520} label="Tests passed" />
          <Passed x={40} y={188} width={520} label="Approved" />
        </g>

        {/* Stage 2: how much of the app it actually covered */}
        <g className="gthk-s2">
          <text x="680" y="60" fill="var(--support)" fontSize="28">
            Operations it could have fixed
          </text>
          <Grid x={680} y={86} size={48} gap={12} />
          <Legend x={680} y={410} size={26} gap={240} />
        </g>

        {/* Stage 3: how long the rest stayed open */}
        <g className="gthk-s3">
          <text x="40" y="360" fill={RED} fontSize="44" fontWeight="700">
            Open for 7 months
          </text>
          <text x="40" y="410" fill="var(--foreground)" fontSize="28">
            Anyone signed in could
          </text>
          <text x="40" y="448" fill="var(--foreground)" fontSize="28">
            change any project.
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gthk-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Stage 1: the change everyone signed off on */}
        <g className="gthk-s1">
          <text x="60" y="66" fill="var(--support)" fontSize="30">
            Onlook · security fix
          </text>
          <Passed x={60} y={98} width={640} label="Tests passed" />
          <Passed x={60} y={194} width={640} label="Approved" />
        </g>

        {/* Stage 2: how much of the app it actually covered */}
        <g className="gthk-s2">
          <text x="60" y="340" fill="var(--support)" fontSize="28">
            Operations it could have fixed
          </text>
          <Grid x={60} y={366} size={56} gap={14} />
          <Legend x={60} y={730} size={28} gap={320} />
        </g>

        {/* Stage 3: how long the rest stayed open */}
        <g className="gthk-s3">
          <text x="60" y="852" fill={RED} fontSize="46" fontWeight="700">
            Open for 7 months
          </text>
          <text x="60" y="902" fill="var(--foreground)" fontSize="28">
            Anyone signed in could change any project.
          </text>
        </g>
      </svg>
    </div>
  );
}
