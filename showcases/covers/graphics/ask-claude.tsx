/* Asking Claude for a cover change: the request, the two studio tools
 * Claude uses (edit_cover writes cover.yaml, screenshot_cover renders the
 * cover so Claude sees it), and the result. Drawn square (1000x1000).
 * Staged to the scene's one caption: the request at once, the edit at
 * 1.6 s, the look at 2.8 s, the finished cover at 3.8 s. CSS animation
 * only; the resting state is the whole exchange. */

function Tool({ y, name, what, cls }: { y: number; name: string; what: string; cls: string }) {
  return (
    <g className={cls}>
      <rect
        x={70}
        y={y}
        width={560}
        height={96}
        rx={20}
        fill="var(--muted)"
        stroke="var(--border)"
        strokeWidth={2}
      />
      <circle
        cx={122}
        cy={y + 48}
        r={24}
        fill="#34d399"
        fillOpacity={0.18}
        stroke="#34d399"
        strokeWidth={3}
      />
      <path
        d={`M${110} ${y + 49} l 9 9 l 16 -19`}
        fill="none"
        stroke="#34d399"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x={166}
        y={y + 44}
        fill="var(--foreground)"
        fontSize={36}
        fontWeight={700}
        style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {name}
      </text>
      <text x={166} y={y + 80} fill="var(--support)" fontSize={28}>
        {what}
      </text>
    </g>
  );
}

export default function AskClaude() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes cvac-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        .cvac-a, .cvac-b, .cvac-c, .cvac-d { animation: cvac-in 0.5s ease-out both; }
        .cvac-a { animation-delay: 0.3s; }
        .cvac-b { animation-delay: 1.6s; }
        .cvac-c { animation-delay: 2.8s; }
        .cvac-d { animation-delay: 3.8s; }
      `}</style>
      <svg
        viewBox="0 0 1000 1000"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="cvac-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a5a" />
            <stop offset="0.6" stopColor="#ffd08a" />
          </linearGradient>
          <clipPath id="cvac-clip">
            <rect x={690} y={430} width={240} height={427} rx={20} />
          </clipPath>
        </defs>

        <g transform="translate(0 -20)">
          {/* the request */}
          <g className="cvac-a">
            <rect x={250} y={90} width={680} height={190} rx={34} fill="var(--primary)" />
            <g fill="var(--primary-foreground)" fontSize={42} fontWeight={600}>
              <text x={292} y={166}>
                Make the headline bigger,
              </text>
              <text x={292} y={222}>
                and put it in a band.
              </text>
            </g>
          </g>

          <Tool y={430} name="edit_cover" what="writes cover.yaml" cls="cvac-b" />
          <Tool y={556} name="screenshot_cover" what="looks at the result" cls="cvac-c" />

          {/* the answer, and the cover it made */}
          <g className="cvac-d">
            <text x={70} y={740} fill="var(--foreground)" fontSize={40} fontWeight={600}>
              Done. It reads at
            </text>
            <text x={70} y={792} fill="var(--foreground)" fontSize={40} fontWeight={600}>
              thumbnail size now.
            </text>
            <g clipPath="url(#cvac-clip)">
              <rect x={690} y={430} width={240} height={427} fill="url(#cvac-sky)" />
              <circle cx={860} cy={530} r={34} fill="#ffe9a8" />
              <path d="M690 690 q 60 -80 120 -28 t 120 -40 v 240 h -240 z" fill="#1f6f78" />
              <rect x={690} y={690} width={240} height={126} fill="var(--primary)" />
              <g fill="var(--primary-foreground)" fontSize={38} fontWeight={800}>
                <text x={708} y={742}>
                  Ship it in
                </text>
                <text x={708} y={786}>
                  60 seconds
                </text>
              </g>
            </g>
            <rect
              x={690}
              y={430}
              width={240}
              height={427}
              rx={20}
              fill="none"
              stroke="#ffffff"
              strokeWidth={4}
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
