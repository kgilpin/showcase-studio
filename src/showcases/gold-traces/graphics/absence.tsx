/* The guard that stopped running, drawn portrait-first: baseline path
 * calls authorize(), the new path skips it, and every test still passes.
 * Staged to the scene's caption windows (caption 1: 0-9.5s, caption 2:
 * 9.5-14s). CSS animation only; resting state is the fully revealed
 * diagram. */
export default function Absence() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes gtab-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtab-s1, .gtab-s2, .gtab-s3, .gtab-s4 { animation: gtab-in 0.7s ease-out both; }
        .gtab-s1 { animation-delay: 0.4s; }
        .gtab-s2 { animation-delay: 3.5s; }
        .gtab-s3 { animation-delay: 6.5s; }
        .gtab-s4 { animation-delay: 10s; }
      `}</style>
      <svg
        viewBox="0 0 760 950"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtab-arrow"
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

        {/* Stage 1: the baseline path, guard in place */}
        <g className="gtab-s1">
          <text
            x="195"
            y="66"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="26"
            fontWeight="600"
          >
            Baseline
          </text>
          <rect
            x="55"
            y="98"
            width="280"
            height="94"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="195"
            y="154"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            save_map_handler
          </text>
          <line
            x1="195"
            y1="192"
            x2="195"
            y2="268"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtab-arrow)"
          />
          <rect
            x="55"
            y="278"
            width="280"
            height="122"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          <text
            x="195"
            y="328"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            authorize()
          </text>
          <rect x="93" y="348" width="204" height="34" rx="17" fill="var(--accent)" />
          <text
            x="195"
            y="372"
            textAnchor="middle"
            fill="var(--accent-foreground)"
            fontSize="19"
            fontWeight="600"
          >
            security.authz
          </text>
          <line
            x1="195"
            y1="400"
            x2="195"
            y2="476"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtab-arrow)"
          />
          <rect
            x="55"
            y="486"
            width="280"
            height="94"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="195"
            y="542"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            save()
          </text>
        </g>

        {/* Stage 2: this release — same shape, no guard */}
        <g className="gtab-s2">
          <text
            x="565"
            y="66"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="26"
            fontWeight="600"
          >
            This release
          </text>
          <rect
            x="425"
            y="98"
            width="280"
            height="94"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="565"
            y="154"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            save_map_handler
          </text>
          <line
            x1="565"
            y1="192"
            x2="565"
            y2="476"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtab-arrow)"
          />
          <rect
            x="425"
            y="486"
            width="280"
            height="94"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="565"
            y="542"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            save()
          </text>
        </g>

        {/* Stage 3: the gap where the guard used to be */}
        <g className="gtab-s3">
          <rect
            x="425"
            y="278"
            width="280"
            height="122"
            rx="14"
            fill="var(--card)"
            stroke="var(--destructive, #e5484d)"
            strokeWidth="2.5"
            strokeDasharray="9 8"
          />
          <text
            x="565"
            y="330"
            textAnchor="middle"
            fill="var(--destructive, #e5484d)"
            fontSize="24"
            fontWeight="600"
          >
            authorize()
          </text>
          <text
            x="565"
            y="366"
            textAnchor="middle"
            fill="var(--destructive, #e5484d)"
            fontSize="20"
          >
            never called
          </text>
          <rect
            x="270"
            y="640"
            width="220"
            height="52"
            rx="26"
            fill="var(--muted)"
            stroke="var(--border)"
          />
          <text x="380" y="674" textAnchor="middle" fill="var(--muted-foreground)" fontSize="21">
            tests: passing
          </text>
        </g>

        {/* Stage 4: the review names it */}
        <g className="gtab-s4">
          <text
            x="380"
            y="780"
            textAnchor="middle"
            fill="var(--destructive, #e5484d)"
            fontSize="22"
            fontWeight="600"
          >
            flagged: security-labeled function
          </text>
          <text
            x="380"
            y="816"
            textAnchor="middle"
            fill="var(--destructive, #e5484d)"
            fontSize="22"
            fontWeight="600"
          >
            absent from this path
          </text>
        </g>
      </svg>
    </div>
  );
}
