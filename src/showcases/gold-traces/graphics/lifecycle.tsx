/* The record → digest → bless cycle, drawn portrait-first for the phone
 * stage and staged to the scene's caption windows (caption 1: 0-12s,
 * caption 2: 12-16s). All content sits above viewBox y≈800 so the overlay
 * caption (export/video contexts) never covers it. CSS animations only
 * (no JS timers): the player's pause, the export freeze, and the video
 * recorder's frame seeking all depend on that. Resting state = the fully
 * revealed diagram. Colors and fonts come from the theme's CSS variables. */
export default function Lifecycle() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes gtlc-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtlc-s1, .gtlc-s2, .gtlc-s3, .gtlc-s4 { animation: gtlc-in 0.7s ease-out both; }
        .gtlc-s1 { animation-delay: 0.3s; }
        .gtlc-s2 { animation-delay: 3s; }
        .gtlc-s3 { animation-delay: 7s; }
        .gtlc-s4 { animation-delay: 12.5s; }
      `}</style>
      <svg
        viewBox="0 0 760 950"
        className="h-full w-full"
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

        {/* Stage 1: gold tests are recorded */}
        <g className="gtlc-s1">
          <rect
            x="210"
            y="36"
            width="340"
            height="100"
            rx="16"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="380"
            y="82"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="27"
            fontWeight="600"
          >
            Gold tests
          </text>
          <text x="380" y="114" textAnchor="middle" fill="var(--support)" fontSize="19">
            curated in the manifest
          </text>
          <line
            x1="380"
            y1="136"
            x2="380"
            y2="176"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />
          <text x="404" y="166" fill="var(--support)" fontSize="19">
            record
          </text>
          <rect
            x="210"
            y="186"
            width="340"
            height="100"
            rx="16"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="380"
            y="232"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="27"
            fontWeight="600"
          >
            Fresh recordings
          </text>
          <text x="380" y="264" textAnchor="middle" fill="var(--support)" fontSize="19">
            this release, sanitized
          </text>
        </g>

        {/* Stage 2: compared against the committed baseline */}
        <g className="gtlc-s2">
          <line
            x1="380"
            y1="286"
            x2="380"
            y2="336"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />
          <rect
            x="190"
            y="346"
            width="380"
            height="120"
            rx="16"
            fill="var(--secondary)"
            stroke="var(--primary)"
            strokeWidth="2"
          />
          <text
            x="380"
            y="398"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="27"
            fontWeight="600"
          >
            Digest compare
          </text>
          <text x="380" y="434" textAnchor="middle" fill="var(--support)" fontSize="19">
            ignores timing · ids · values
          </text>

          <rect
            x="40"
            y="536"
            width="280"
            height="108"
            rx="16"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="180"
            y="584"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="27"
            fontWeight="600"
          >
            Baseline
          </text>
          <text x="180" y="616" textAnchor="middle" fill="var(--support)" fontSize="19">
            committed in git
          </text>
          <polyline
            points="180,536 180,406 188,406"
            fill="none"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />
        </g>

        {/* Stage 3: the three outcomes */}
        <g className="gtlc-s3">
          <line
            x1="470"
            y1="466"
            x2="555"
            y2="514"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />
          <line
            x1="490"
            y1="466"
            x2="575"
            y2="602"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />
          <line
            x1="510"
            y1="466"
            x2="592"
            y2="690"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtlc-arrow)"
          />

          <rect x="460" y="520" width="260" height="60" rx="30" fill="var(--primary)" />
          <text
            x="590"
            y="558"
            textAnchor="middle"
            fill="var(--primary-foreground)"
            fontSize="25"
            fontWeight="600"
          >
            2 bless
          </text>
          <rect x="490" y="608" width="230" height="60" rx="30" fill="var(--accent)" />
          <text
            x="605"
            y="646"
            textAnchor="middle"
            fill="var(--accent-foreground)"
            fontSize="25"
            fontWeight="600"
          >
            1 seed
          </text>
          <rect
            x="490"
            y="696"
            width="230"
            height="60"
            rx="30"
            fill="var(--muted)"
            stroke="var(--border)"
          />
          <text
            x="605"
            y="734"
            textAnchor="middle"
            fill="var(--muted-foreground)"
            fontSize="25"
            fontWeight="600"
          >
            9 unchanged
          </text>
        </g>

        {/* Stage 4: blessed recordings become the new baseline */}
        <g className="gtlc-s4">
          <polyline
            points="720,550 742,550 742,796 120,796 120,652"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.5"
            strokeDasharray="8 7"
            markerEnd="url(#gtlc-arrow)"
          />
          <text x="250" y="690" textAnchor="middle" fill="var(--support)" fontSize="19">
            blessed recordings become
          </text>
          <text x="250" y="718" textAnchor="middle" fill="var(--support)" fontSize="19">
            the new baseline
          </text>
        </g>
      </svg>
    </div>
  );
}
