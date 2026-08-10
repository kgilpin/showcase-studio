/* A stylized sequence diagram — the artifact the digest is computed from —
 * drawn portrait-first, with a security label on the changed call and a
 * strip of everything the digest ignores. Staged to the scene's caption
 * windows (caption 1: 0-8s, caption 2: 8-13.5s). CSS animation only;
 * resting state is the fully revealed diagram. */
export default function Deterministic() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes gtdt-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: none; }
        }
        .gtdt-s1, .gtdt-s2, .gtdt-s3 { animation: gtdt-in 0.7s ease-out both; }
        .gtdt-s1 { animation-delay: 0.4s; }
        .gtdt-s2 { animation-delay: 4s; }
        .gtdt-s3 { animation-delay: 7.5s; }
      `}</style>
      <svg
        viewBox="0 0 760 950"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker
            id="gtdt-arrow"
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

        {/* Stage 1: the sequence diagram — what the digest sees */}
        <g className="gtdt-s1">
          <rect
            x="40"
            y="40"
            width="170"
            height="62"
            rx="12"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="125"
            y="80"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            api
          </text>
          <rect
            x="295"
            y="40"
            width="170"
            height="62"
            rx="12"
            fill="var(--secondary)"
            stroke="var(--border)"
          />
          <text
            x="380"
            y="80"
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            domain
          </text>
          <rect x="550" y="40" width="170" height="62" rx="12" fill="var(--primary)" />
          <text
            x="635"
            y="80"
            textAnchor="middle"
            fill="var(--primary-foreground)"
            fontSize="24"
            fontWeight="600"
          >
            Database
          </text>
          <line
            x1="125"
            y1="102"
            x2="125"
            y2="620"
            stroke="var(--support)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="4 6"
          />
          <line
            x1="380"
            y1="102"
            x2="380"
            y2="620"
            stroke="var(--support)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="4 6"
          />
          <line
            x1="635"
            y1="102"
            x2="635"
            y2="620"
            stroke="var(--support)"
            strokeOpacity="0.55"
            strokeWidth="1.5"
            strokeDasharray="4 6"
          />

          <text x="140" y="166" fill="var(--foreground)" fontSize="21">
            save_map(id, map)
          </text>
          <line
            x1="125"
            y1="182"
            x2="370"
            y2="182"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtdt-arrow)"
          />

          <text x="395" y="386" fill="var(--foreground)" fontSize="21">
            SELECT owner FROM maps …
          </text>
          <line
            x1="380"
            y1="402"
            x2="625"
            y2="402"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtdt-arrow)"
          />

          <text x="395" y="496" fill="var(--foreground)" fontSize="21">
            UPDATE maps SET …
          </text>
          <line
            x1="380"
            y1="512"
            x2="625"
            y2="512"
            stroke="var(--support)"
            strokeWidth="2.5"
            markerEnd="url(#gtdt-arrow)"
          />

          <text x="140" y="576" fill="var(--support)" fontSize="20">
            ok
          </text>
          <line
            x1="370"
            y1="592"
            x2="135"
            y2="592"
            stroke="var(--support)"
            strokeWidth="2.5"
            strokeDasharray="7 6"
            markerEnd="url(#gtdt-arrow)"
          />
        </g>

        {/* Stage 2: the changed call carries its label */}
        <g className="gtdt-s2">
          <text x="140" y="252" fill="var(--foreground)" fontSize="21">
            check_ownership(user, map)
          </text>
          <line
            x1="125"
            y1="268"
            x2="370"
            y2="268"
            stroke="var(--primary)"
            strokeWidth="3"
            markerEnd="url(#gtdt-arrow)"
          />
          <rect x="150" y="284" width="196" height="34" rx="17" fill="var(--accent)" />
          <text
            x="248"
            y="308"
            textAnchor="middle"
            fill="var(--accent-foreground)"
            fontSize="19"
            fontWeight="600"
          >
            security.authz
          </text>
        </g>

        {/* Stage 3: what the digest ignores */}
        <g className="gtdt-s3">
          <line x1="40" y1="652" x2="720" y2="652" stroke="var(--border)" />
          <text x="60" y="706" fill="var(--support)" fontSize="22">
            ignored by the digest:
          </text>
          <text x="400" y="706" fill="var(--support)" fontSize="22" textDecoration="line-through">
            elapsed 1.41 ms
          </text>
          <text x="400" y="748" fill="var(--support)" fontSize="22" textDecoration="line-through">
            id 4555196128
          </text>
          <text x="400" y="790" fill="var(--support)" fontSize="22" textDecoration="line-through">
            value "&lt;v8&gt;"
          </text>
          <text x="60" y="752" fill="var(--foreground)" fontSize="22">
            compared: the calls,
          </text>
          <text x="60" y="790" fill="var(--foreground)" fontSize="22">
            their order, labels, queries
          </text>
        </g>
      </svg>
    </div>
  );
}
