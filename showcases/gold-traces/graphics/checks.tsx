/* Checks: a review reads the changed lines; the recordings show what the
 * change did everywhere else, and every finding cites the recording it
 * came from. One idea, big type — nothing smaller than 26 units. Staged to
 * the scene's three caption windows (0-3.6s, 3.6-12.1s, 12.1-16.6s).
 * Source: goldtrace-examples, onlook-partial-authorization-check/REVIEW.md.
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const FOUND = ["side effects", "missing permission checks", "new database queries"];

function Found({ x, y, index }: { x: number; y: number; index: number }) {
  return (
    <g>
      <circle cx={x + 16} cy={y - 10} r={12} fill="var(--primary)" />
      <text x={x + 48} y={y} fill="var(--foreground)" fontSize={34}>
        {FOUND[index]}
      </text>
    </g>
  );
}

export default function Checks() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtck-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtck-s1, .gtck-s2, .gtck-s3 { animation: gtck-in 0.7s ease-out both; }
        .gtck-s1 { animation-delay: 0.3s; }
        .gtck-s2 { animation-delay: 3.8s; }
        .gtck-s3 { animation-delay: 12.3s; }
        .gtck-tall { display: block; }
        .gtck-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtck-tall { display: none; }
          .gtck-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtck-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Stage 1: what a code review can see */}
        <g className="gtck-s1">
          <rect x="40" y="60" width="520" height="240" rx="20" fill="var(--muted)" />
          <text x="300" y="150" textAnchor="middle" fill="var(--support)" fontSize="30">
            A code review sees
          </text>
          <text x="300" y="196" textAnchor="middle" fill="var(--support)" fontSize="34" fontWeight="600">
            the changed lines
          </text>
          <rect x="120" y="230" width="360" height="12" rx="6" fill="var(--support)" fillOpacity="0.4" />
          <rect x="120" y="254" width="240" height="12" rx="6" fill="var(--support)" fillOpacity="0.4" />
        </g>

        {/* Stage 2: what the recordings add */}
        <g className="gtck-s2">
          <text x="660" y="90" fill="var(--support)" fontSize="30">
            The recordings also find
          </text>
          {FOUND.map((item, i) => (
            <Found key={item} x={660} y={160 + i * 62} index={i} />
          ))}
        </g>

        {/* Stage 3: the evidence */}
        <g className="gtck-s3">
          <rect x="40" y="380" width="1200" height="110" rx="20" fill="none" stroke="var(--primary)" strokeWidth="3" />
          <text x="640" y="450" textAnchor="middle" fill="var(--foreground)" fontSize="36" fontWeight="600">
            Every finding cites the recording it came from
          </text>
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtck-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Stage 1: what a code review can see */}
        <g className="gtck-s1">
          <rect x="40" y="60" width="680" height="240" rx="20" fill="var(--muted)" />
          <text x="380" y="150" textAnchor="middle" fill="var(--support)" fontSize="30">
            A code review sees
          </text>
          <text x="380" y="196" textAnchor="middle" fill="var(--support)" fontSize="34" fontWeight="600">
            the changed lines
          </text>
          <rect x="180" y="230" width="400" height="12" rx="6" fill="var(--support)" fillOpacity="0.4" />
          <rect x="180" y="254" width="260" height="12" rx="6" fill="var(--support)" fillOpacity="0.4" />
        </g>

        {/* Stage 2: what the recordings add */}
        <g className="gtck-s2">
          <text x="40" y="400" fill="var(--support)" fontSize="30">
            The recordings also find
          </text>
          {FOUND.map((item, i) => (
            <Found key={item} x={40} y={470 + i * 66} index={i} />
          ))}
        </g>

        {/* Stage 3: the evidence */}
        <g className="gtck-s3">
          <rect x="40" y="700" width="680" height="170" rx="20" fill="none" stroke="var(--primary)" strokeWidth="3" />
          <text x="380" y="770" textAnchor="middle" fill="var(--foreground)" fontSize="34" fontWeight="600">
            Every finding cites
          </text>
          <text x="380" y="816" textAnchor="middle" fill="var(--foreground)" fontSize="34" fontWeight="600">
            the recording it came from
          </text>
        </g>
      </svg>
    </div>
  );
}
