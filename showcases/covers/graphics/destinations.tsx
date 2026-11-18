/* One cover, four images: cover.yaml at the top, then the three 9:16
 * covers (TikTok, Instagram, YouTube Shorts) and the regular YouTube
 * video's 16:9 thumbnail. Sizes and file types are the studio's own
 * (COVER_DESTINATIONS). Drawn square (1000x1000). Staged to the scene's
 * two captions: the three portrait covers with the first, the YouTube
 * thumbnail with the second (4.6 s). CSS animation only; the resting
 * state is the whole diagram. */

const PW = 200;
const PH = 356;
const PY = 230;
const PXS = [110, 400, 690];
const NAMES = ["TikTok", "Instagram", "Shorts"];

function Sky({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ff9a5a" />
      <stop offset="0.6" stopColor="#ffd08a" />
    </linearGradient>
  );
}

function Portrait({ x, name, i }: { x: number; name: string; i: number }) {
  return (
    <g>
      <path
        d={`M500 150 C 500 190 ${x + PW / 2} 180 ${x + PW / 2} ${PY - 8}`}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={4}
        opacity={0.7}
      />
      <g clipPath={`url(#cvds-clip-${i})`}>
        <rect x={x} y={PY} width={PW} height={PH} fill="url(#cvds-sky)" />
        <circle cx={x + 140} cy={PY + 80} r={30} fill="#ffe9a8" />
        <path d={`M${x} ${PY + 210} q 50 -70 100 -24 t 100 -36 v 220 h -200 z`} fill="#1f6f78" />
        <rect x={x} y={PY + 230} width={PW} height={110} fill="var(--primary)" />
        <g fill="var(--primary-foreground)" fontSize={30} fontWeight={800}>
          <text x={x + 16} y={PY + 274}>
            Ship it in
          </text>
          <text x={x + 16} y={PY + 310}>
            60 seconds
          </text>
        </g>
      </g>
      <rect
        x={x}
        y={PY}
        width={PW}
        height={PH}
        rx={18}
        fill="none"
        stroke="var(--border)"
        strokeWidth={3}
      />
      <text
        x={x + PW / 2}
        y={PY + PH + 52}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={38}
        fontWeight={700}
      >
        {name}
      </text>
    </g>
  );
}

export default function Destinations() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes cvds-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        .cvds-a, .cvds-b, .cvds-c { animation: cvds-in 0.6s ease-out both; }
        .cvds-a { animation-delay: 0.3s; }
        .cvds-b { animation-delay: 1s; }
        .cvds-c { animation-delay: 4.6s; }
      `}</style>
      <svg
        viewBox="0 0 1000 1000"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <Sky id="cvds-sky" />
          {PXS.map((x, i) => (
            <clipPath key={i} id={`cvds-clip-${i}`}>
              <rect x={x} y={PY} width={PW} height={PH} rx={18} />
            </clipPath>
          ))}
          <clipPath id="cvds-clip-wide">
            <rect x={110} y={730} width={400} height={225} rx={18} />
          </clipPath>
        </defs>

        <g transform="translate(65 10) scale(0.87)">
          {/* the one file */}
          <g className="cvds-a">
            <rect
              x={340}
              y={50}
              width={320}
              height={100}
              rx={20}
              fill="var(--muted)"
              stroke="var(--primary)"
              strokeWidth={3}
            />
            <text
              x={500}
              y={116}
              textAnchor="middle"
              fill="var(--foreground)"
              fontSize={46}
              fontWeight={700}
            >
              cover.yaml
            </text>
          </g>

          {/* the three 9:16 covers */}
          <g className="cvds-b">
            {PXS.map((x, i) => (
              <Portrait key={i} x={x} name={NAMES[i]} i={i} />
            ))}
            <text x={500} y={PY + PH + 100} textAnchor="middle" fill="var(--support)" fontSize={30}>
              1080 × 1920 PNG
            </text>
          </g>

          {/* the regular YouTube video's 16:9 thumbnail */}
          <g className="cvds-c">
            <g clipPath="url(#cvds-clip-wide)">
              <rect x={110} y={730} width={400} height={225} fill="var(--background)" />
              <rect x={294} y={730} width={216} height={225} fill="url(#cvds-sky)" />
              <circle cx={440} cy={790} r={26} fill="#ffe9a8" />
              <path d="M294 880 q 50 -60 110 -20 t 106 -30 v 130 h -216 z" fill="#1f6f78" />
              <g fill="var(--foreground)" fontSize={30} fontWeight={800}>
                <text x={128} y={832}>
                  Ship it in
                </text>
                <text x={128} y={868}>
                  60 seconds
                </text>
              </g>
            </g>
            <rect
              x={110}
              y={730}
              width={400}
              height={225}
              rx={18}
              fill="none"
              stroke="var(--border)"
              strokeWidth={3}
            />
            <text x={550} y={822} fill="var(--foreground)" fontSize={44} fontWeight={700}>
              YouTube
            </text>
            <text x={550} y={870} fill="var(--support)" fontSize={30}>
              16:9 thumbnail
            </text>
            <text x={550} y={912} fill="var(--support)" fontSize={30}>
              1280 × 720 JPEG
            </text>
          </g>
        </g>
      </svg>
    </div>
  );
}
