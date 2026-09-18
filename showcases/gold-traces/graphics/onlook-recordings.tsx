/* What the recordings showed: the same request, as two recorded paths.
 * Where the fix reached, the permission check runs and the stranger is
 * refused; everywhere else the check is simply absent and the project
 * changes. The missing step is the diagram. Nothing smaller than 26 units,
 * no identifiers. Staged to the scene's caption windows (caption 1:
 * 0-9.1s, caption 2: 9.1-18.4s).
 * Source: goldtrace-examples, onlook-partial-authorization-check/REVIEW.md.
 * CSS animation only; resting state is the fully revealed diagram. Wide
 * panels (the 4:3 canvas) get a landscape layout that fills the top
 * two-thirds and leaves the bottom clear for overlay captions. */
const RED = "#f87171";
const GREEN = "#34d399";

const STILL_OPEN = ["reads your project", "changes what runs", "removes you"];

function Step({
  x,
  y,
  width,
  label,
  color,
  dashed = false,
  strong = false,
}: {
  x: number;
  y: number;
  width: number;
  label: string;
  color: string;
  dashed?: boolean;
  strong?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={74}
        rx={14}
        fill={dashed ? "none" : "var(--secondary)"}
        stroke={color}
        strokeWidth={dashed ? 3 : 2}
        strokeDasharray={dashed ? "10 9" : undefined}
        strokeOpacity={dashed ? 1 : 0.5}
      />
      <text
        x={x + width / 2}
        y={y + 48}
        textAnchor="middle"
        fill={strong || dashed ? color : "var(--foreground)"}
        fontSize={30}
        fontWeight={strong || dashed ? 700 : 400}
      >
        {label}
      </text>
    </g>
  );
}

function Path({
  x,
  y,
  width,
  heading,
  color,
  checkLabel,
  outcome,
  missing,
  marker,
  gap = 116,
}: {
  x: number;
  y: number;
  width: number;
  heading: string;
  color: string;
  checkLabel: string;
  outcome: string;
  missing: boolean;
  /** Marker id of the layout this path is drawn in — a marker inside a
   *  hidden SVG doesn't render, so each layout defines its own. */
  marker: string;
  gap?: number;
}) {
  return (
    <g>
      <text x={x + width / 2} y={y} textAnchor="middle" fill="var(--support)" fontSize={28}>
        {heading}
      </text>
      <Step x={x} y={y + 24} width={width} label="request" color="var(--border)" />
      <line
        x1={x + width / 2}
        y1={y + 98}
        x2={x + width / 2}
        y2={y + gap + 18}
        stroke="var(--support)"
        strokeWidth={4}
        markerEnd={`url(#${marker})`}
      />
      <Step
        x={x}
        y={y + gap + 24}
        width={width}
        label={checkLabel}
        color={color}
        dashed={missing}
        strong={!missing}
      />
      <line
        x1={x + width / 2}
        y1={y + gap + 98}
        x2={x + width / 2}
        y2={y + gap * 2 + 18}
        stroke="var(--support)"
        strokeWidth={4}
        markerEnd={`url(#${marker})`}
      />
      <Step x={x} y={y + gap * 2 + 24} width={width} label={outcome} color={color} strong />
    </g>
  );
}

export default function OnlookRecordings() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)", containerType: "size" }}>
      <style>{`
        @keyframes gtor-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtor-s1, .gtor-s2, .gtor-s3 { animation: gtor-in 0.7s ease-out both; }
        .gtor-s1 { animation-delay: 0.3s; }
        .gtor-s2 { animation-delay: 9.3s; }
        .gtor-s3 { animation-delay: 13s; }
        .gtor-tall { display: block; }
        .gtor-wide { display: none; }
        @container (min-aspect-ratio: 1/1) {
          .gtor-tall { display: none; }
          .gtor-wide { display: block; }
        }
      `}</style>

      <svg
        viewBox="0 0 1280 560"
        className="gtor-wide"
        style={{ width: "100%", height: "66%", fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtor-arrow-w"
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

        <g className="gtor-s1">
          <Path
            x={40}
            y={54}
            width={420}
            heading="where the fix reached"
            color={GREEN}
            checkLabel="permission check"
            outcome="refused"
            missing={false}
            marker="gtor-arrow-w"
          />
        </g>
        <g className="gtor-s2">
          <Path
            x={540}
            y={54}
            width={420}
            heading="everywhere else"
            color={RED}
            checkLabel="no check"
            outcome="project changed"
            missing
            marker="gtor-arrow-w"
          />
        </g>
        <g className="gtor-s3">
          <text x="1020" y="140" fill="var(--support)" fontSize="28">
            so a stranger
          </text>
          {STILL_OPEN.map((line, i) => (
            <text key={line} x="1020" y={196 + i * 52} fill={RED} fontSize={30} fontWeight={600}>
              {line}
            </text>
          ))}
        </g>
      </svg>

      <svg
        viewBox="0 0 760 950"
        className="h-full w-full gtor-tall"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtor-arrow-t"
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

        <g className="gtor-s1">
          <Path
            x={40}
            y={60}
            width={310}
            heading="where the fix reached"
            color={GREEN}
            checkLabel="permission check"
            outcome="refused"
            missing={false}
            marker="gtor-arrow-t"
          />
        </g>
        <g className="gtor-s2">
          <Path
            x={410}
            y={60}
            width={310}
            heading="everywhere else"
            color={RED}
            checkLabel="no check"
            outcome="project changed"
            missing
            marker="gtor-arrow-t"
          />
        </g>
        <g className="gtor-s3">
          <text x="380" y="560" textAnchor="middle" fill="var(--support)" fontSize="28">
            so a stranger
          </text>
          {STILL_OPEN.map((line, i) => (
            <text
              key={line}
              x="380"
              y={620 + i * 56}
              textAnchor="middle"
              fill={RED}
              fontSize={32}
              fontWeight={600}
            >
              {line}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
