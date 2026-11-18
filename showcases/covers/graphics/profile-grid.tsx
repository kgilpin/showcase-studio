/* The hook: a profile grid, the way TikTok and Instagram show one. Five
 * tiles are whatever frame the platform picked (blurred, a caption cut
 * off mid-word); one is a designed cover, and it is the one you look at.
 * Drawn 9:16 (1080x1920) to fill a footage slide. The grid sits between
 * 15% and 58% of the height: above TikTok's description and the bottom
 * caption, below TikTok's tabs. Staged to the scene's two captions: the
 * designed cover lights up during the first (1.4 s), the cut-off captions
 * on the other tiles appear with the second (4.4 s). CSS animation only;
 * the resting state is everything shown. */

const W = 300;
const H = 400;
const GAP = 30;
const LEFT = 60;
const TOP = 300;

/* Each dull tile: two blurred blobs and the caption fragment the frame
 * happened to catch. */
const DULL: { col: number; row: number; hue: number; text: string }[] = [
  { col: 0, row: 0, hue: 215, text: "so the th" },
  { col: 1, row: 0, hue: 260, text: "and then w" },
  { col: 2, row: 0, hue: 200, text: "which is" },
  { col: 0, row: 1, hue: 240, text: "um, so" },
  { col: 2, row: 1, hue: 225, text: "you can al" },
];

const tileX = (col: number) => LEFT + col * (W + GAP);
const tileY = (row: number) => TOP + row * (H + GAP);

function DullTile({ col, row, hue, text }: (typeof DULL)[number]) {
  const x = tileX(col);
  const y = tileY(row);
  const id = `cvpg-clip-${col}-${row}`;
  return (
    <g>
      <clipPath id={id}>
        <rect x={x} y={y} width={W} height={H} rx={18} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <rect x={x} y={y} width={W} height={H} fill={`hsl(${hue} 22% 16%)`} />
        <g filter="url(#cvpg-blur)" opacity={0.75}>
          <ellipse cx={x + 110} cy={y + 150} rx={120} ry={90} fill={`hsl(${hue} 25% 30%)`} />
          <ellipse cx={x + 220} cy={y + 290} rx={110} ry={80} fill={`hsl(${hue + 30} 18% 24%)`} />
        </g>
        <g className="cvpg-fragment">
          <rect x={x + 24} y={y + 300} width={W - 70} height={58} rx={12} fill="rgba(0,0,0,0.6)" />
          <text x={x + 42} y={y + 341} fill="rgba(255,255,255,0.72)" fontSize={34} fontWeight={600}>
            {text}
          </text>
        </g>
      </g>
      <rect
        x={x}
        y={y}
        width={W}
        height={H}
        rx={18}
        fill="none"
        stroke="var(--border)"
        strokeWidth={2}
      />
    </g>
  );
}

/* The designed cover: a picture, a band in the theme's color, a headline. */
function CoverTile() {
  const x = tileX(1);
  const y = tileY(1);
  return (
    <g className="cvpg-cover" style={{ transformOrigin: `${x + W / 2}px ${y + H / 2}px` }}>
      <clipPath id="cvpg-clip-cover">
        <rect x={x} y={y} width={W} height={H} rx={18} />
      </clipPath>
      <g clipPath="url(#cvpg-clip-cover)">
        <rect x={x} y={y} width={W} height={H} fill="url(#cvpg-sky)" />
        <circle cx={x + 215} cy={y + 95} r={44} fill="#ffe9a8" />
        <path d={`M${x} ${y + 250} q 80 -90 160 -30 t 140 -40 v 220 h -300 z`} fill="#1f6f78" />
        <rect x={x} y={y + 252} width={W} height={148} fill="var(--primary)" />
        <text
          x={x + 24}
          y={y + 312}
          fill="var(--primary-foreground)"
          fontSize={46}
          fontWeight={800}
          style={{ fontFamily: "var(--font-body)" }}
        >
          Ship it in
        </text>
        <text
          x={x + 24}
          y={y + 366}
          fill="var(--primary-foreground)"
          fontSize={46}
          fontWeight={800}
          style={{ fontFamily: "var(--font-body)" }}
        >
          60 seconds
        </text>
      </g>
      <rect
        className="cvpg-ring"
        x={x - 7}
        y={y - 7}
        width={W + 14}
        height={H + 14}
        rx={24}
        fill="none"
        stroke="#ffffff"
        strokeWidth={6}
      />
    </g>
  );
}

export default function ProfileGrid() {
  return (
    <div className="h-full w-full" style={{ background: "var(--background)" }}>
      <style>{`
        @keyframes cvpg-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes cvpg-pop {
          from { transform: scale(1); }
          to { transform: scale(1.07); }
        }
        @keyframes cvpg-show {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .cvpg-grid { animation: cvpg-in 0.6s ease-out 0.2s both; }
        .cvpg-cover { transform: scale(1.07); animation: cvpg-pop 0.5s ease-out 1.4s both; }
        .cvpg-ring { animation: cvpg-show 0.5s ease-out 1.4s both; }
        .cvpg-fragment { animation: cvpg-show 0.5s ease-out 4.4s both; }
      `}</style>
      <svg
        viewBox="0 0 1080 1920"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="cvpg-blur" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="26" />
          </filter>
          <linearGradient id="cvpg-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a5a" />
            <stop offset="0.65" stopColor="#ffd08a" />
          </linearGradient>
        </defs>

        <g className="cvpg-grid">
          {/* The profile's header: a picture, a name, a line of numbers. */}
          <circle
            cx={116}
            cy={170}
            r={56}
            fill="var(--muted)"
            stroke="var(--border)"
            strokeWidth={2}
          />
          <rect
            x={200}
            y={128}
            width={300}
            height={34}
            rx={17}
            fill="var(--muted-foreground)"
            opacity={0.6}
          />
          <rect
            x={200}
            y={182}
            width={460}
            height={24}
            rx={12}
            fill="var(--muted-foreground)"
            opacity={0.28}
          />

          {DULL.map((tile) => (
            <DullTile key={`${tile.col}-${tile.row}`} {...tile} />
          ))}
          <CoverTile />
        </g>
      </svg>
    </div>
  );
}
