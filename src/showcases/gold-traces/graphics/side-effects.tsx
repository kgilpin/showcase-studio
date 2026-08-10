/* Intent vs. footprint, drawn portrait-first: the diff at the top, the
 * recorded call graph below, with the out-of-scope call highlighted.
 * Staged to the scene's caption windows (caption 1: 0-9s, caption 2:
 * 9-14.5s). CSS animation only; resting state is the fully revealed
 * diagram. */
export default function SideEffects() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes gtse-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtse-s1, .gtse-s2, .gtse-s3, .gtse-s4 { animation: gtse-in 0.7s ease-out both; }
        .gtse-s1 { animation-delay: 0.3s; }
        .gtse-s2 { animation-delay: 2.5s; }
        .gtse-s3 { animation-delay: 5.5s; }
        .gtse-s4 { animation-delay: 9.5s; }
      `}</style>
      <svg
        viewBox="0 0 760 950"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtse-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--support)" />
          </marker>
          <marker
            id="gtse-arrow-hot"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--primary)" />
          </marker>
        </defs>

        {/* Stage 1: the diff — the lines you edited */}
        <g className="gtse-s1">
          <text
            x="380"
            y="56"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="26"
            fontWeight="600"
          >
            The diff
          </text>
          <rect
            x="140"
            y="80"
            width="480"
            height="150"
            rx="16"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text x="180" y="132" fill="var(--foreground)" fontSize="23">
            discount.py
          </text>
          <text x="580" y="132" textAnchor="end" fill="var(--accent)" fontSize="22">
            +12 −4
          </text>
          <text x="180" y="180" fill="var(--foreground)" fontSize="23">
            test_discount.py
          </text>
          <text x="580" y="180" textAnchor="end" fill="var(--accent)" fontSize="22">
            +8
          </text>
          <line
            x1="380"
            y1="230"
            x2="380"
            y2="298"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtse-arrow)"
          />
          <text x="404" y="272" fill="var(--support)" fontSize="19">
            recorded run
          </text>
        </g>

        {/* Stage 2: the in-scope call graph */}
        <g className="gtse-s2">
          <rect
            x="120"
            y="308"
            width="420"
            height="380"
            rx="18"
            fill="none"
            stroke="var(--border)"
            strokeDasharray="9 8"
          />
          <rect
            x="180"
            y="352"
            width="300"
            height="110"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="330"
            y="400"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="25"
            fontWeight="600"
          >
            calculate_discount
          </text>
          <text x="330" y="436" textAnchor="middle" fill="var(--support)" fontSize="19">
            discount.py
          </text>
          <line
            x1="330"
            y1="462"
            x2="330"
            y2="526"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtse-arrow)"
          />
          <rect
            x="180"
            y="536"
            width="300"
            height="110"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="330"
            y="584"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="25"
            fontWeight="600"
          >
            update_total
          </text>
          <text x="330" y="620" textAnchor="middle" fill="var(--support)" fontSize="19">
            orders.py
          </text>
        </g>

        {/* Stage 3: the call outside the scope, firing twice */}
        <g className="gtse-s3">
          <line
            x1="480"
            y1="606"
            x2="560"
            y2="742"
            stroke="var(--primary)"
            strokeWidth="3"
            markerEnd="url(#gtse-arrow-hot)"
          />
          <rect
            x="330"
            y="752"
            width="380"
            height="122"
            rx="14"
            fill="var(--secondary)"
            stroke="var(--primary)"
            strokeWidth="2.5"
          />
          <text
            x="520"
            y="802"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="25"
            fontWeight="600"
          >
            notifications.send
          </text>
          <text
            x="520"
            y="842"
            textAnchor="middle"
            fill="var(--primary)"
            fontSize="23"
            fontWeight="600"
          >
            called ×2 per order
          </text>
        </g>

        {/* Stage 4: naming the finding */}
        <g className="gtse-s4">
          <text x="330" y="342" textAnchor="middle" fill="var(--support)" fontSize="19">
            stated scope of the change
          </text>
          <text
            x="520"
            y="920"
            textAnchor="middle"
            fill="var(--primary)"
            fontSize="22"
            fontWeight="600"
          >
            outside the stated scope
          </text>
        </g>
      </svg>
    </div>
  );
}
