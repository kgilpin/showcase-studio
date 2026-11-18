/* What a profile grid does to a 9:16 cover: it shows only the middle 3:4,
 * cutting 12.5% off the top and the bottom (COVER_GRID_CROP). Left, the
 * whole cover with the two strips marked; right, the tile the grid shows,
 * headline intact. Drawn square (1000x1000). Staged to the scene's two
 * captions: the cover and its cut strips with the first, the grid tile
 * with the second (3.6 s). CSS animation only; the resting state is the
 * whole diagram. */

const X = 80;
const Y = 50;
const W = 387;
const H = 688;
const CUT = H * 0.125;

const TX = 610;
const TW = 310;
const TH = (TW * 4) / 3;
const TY = Y + (H - TH) / 2;

/* The cover's picture and headline, drawn in a w-by-h box whose middle
 * 3:4 holds everything that matters. */
function Cover({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const s = w / W;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="url(#cvgc-sky)" />
      <circle cx={x + 280 * s} cy={y + 190 * s} r={50 * s} fill="#ffe9a8" />
      <path
        d={`M${x} ${y + 420 * s} q ${100 * s} ${-120 * s} ${200 * s} ${-40 * s} t ${187 * s} ${-60 * s} V ${y + h} H ${x} z`}
        fill="#1f6f78"
      />
      <rect x={x} y={y + 440 * s} width={w} height={162 * s} fill="var(--primary)" />
      <g fill="var(--primary-foreground)" fontSize={54 * s} fontWeight={800}>
        <text x={x + 30 * s} y={y + 510 * s}>
          Ship it in
        </text>
        <text x={x + 30 * s} y={y + 572 * s}>
          60 seconds
        </text>
      </g>
    </g>
  );
}

export default function GridCrop() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes cvgc-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes cvgc-show {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .cvgc-a { animation: cvgc-in 0.6s ease-out 0.3s both; }
        .cvgc-b { animation: cvgc-show 0.6s ease-out 1.2s both; }
        .cvgc-c { animation: cvgc-in 0.6s ease-out 3.6s both; }
      `}</style>
      <svg
        viewBox="0 0 1000 1000"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="cvgc-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a5a" />
            <stop offset="0.6" stopColor="#ffd08a" />
          </linearGradient>
          <pattern
            id="cvgc-hatch"
            width="18"
            height="18"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="18" height="18" fill="rgba(0,0,0,0.72)" />
            <rect width="5" height="18" fill="rgba(248,113,113,0.75)" />
          </pattern>
          <clipPath id="cvgc-clip-full">
            <rect x={X} y={Y} width={W} height={H} rx={24} />
          </clipPath>
          <clipPath id="cvgc-clip-tile">
            <rect x={TX} y={TY} width={TW} height={TH} rx={20} />
          </clipPath>
        </defs>

        {/* the whole 9:16 cover */}
        <g className="cvgc-a">
          <g clipPath="url(#cvgc-clip-full)">
            <Cover x={X} y={Y} w={W} h={H} />
          </g>
          <rect
            x={X}
            y={Y}
            width={W}
            height={H}
            rx={24}
            fill="none"
            stroke="var(--border)"
            strokeWidth={3}
          />
          <text
            x={X + W / 2}
            y={Y + H + 62}
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize={40}
            fontWeight={700}
          >
            Your cover
          </text>
          <text
            x={X + W / 2}
            y={Y + H + 106}
            textAnchor="middle"
            fill="var(--support)"
            fontSize={30}
          >
            9:16, the whole image
          </text>
        </g>

        {/* the strips a profile grid cuts off */}
        <g className="cvgc-b">
          <g clipPath="url(#cvgc-clip-full)">
            <rect x={X} y={Y} width={W} height={CUT} fill="url(#cvgc-hatch)" />
            <rect x={X} y={Y + H - CUT} width={W} height={CUT} fill="url(#cvgc-hatch)" />
          </g>
          <g fill="#ffffff" fontSize={32} fontWeight={700} textAnchor="middle">
            <text x={X + W / 2} y={Y + CUT / 2 + 11}>
              cut off
            </text>
            <text x={X + W / 2} y={Y + H - CUT / 2 + 11}>
              cut off
            </text>
          </g>
        </g>

        {/* the tile the grid shows: the middle 3:4 */}
        <g className="cvgc-c">
          <path
            d={`M${X + W + 24} ${Y + H / 2} H ${TX - 34}`}
            stroke="var(--primary)"
            strokeWidth={5}
            fill="none"
          />
          <path
            d={`M${TX - 50} ${Y + H / 2 - 16} L ${TX - 26} ${Y + H / 2} L ${TX - 50} ${Y + H / 2 + 16}`}
            stroke="var(--primary)"
            strokeWidth={5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <g clipPath="url(#cvgc-clip-tile)">
            <Cover x={TX} y={TY - (TW / W) * CUT} w={TW} h={(TW / W) * H} />
          </g>
          <rect
            x={TX}
            y={TY}
            width={TW}
            height={TH}
            rx={20}
            fill="none"
            stroke="#ffffff"
            strokeWidth={5}
          />
          <text
            x={TX + TW / 2}
            y={TY + TH + 62}
            textAnchor="middle"
            fill="var(--foreground)"
            fontSize={40}
            fontWeight={700}
          >
            In the grid
          </text>
          <text
            x={TX + TW / 2}
            y={TY + TH + 106}
            textAnchor="middle"
            fill="var(--support)"
            fontSize={30}
          >
            headline intact
          </text>
        </g>
      </svg>
    </div>
  );
}
