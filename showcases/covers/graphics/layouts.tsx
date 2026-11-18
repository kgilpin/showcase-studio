/* The three cover layouts, as small 9:16 covers side by side: fade (text
 * over a dark fade), band (text in a band of the theme's color), split
 * (text above an app screenshot shown whole). Drawn square (1000x1000) so
 * it reads in the TikTok frame and the 4:3 embed alike. Staged to the
 * scene's two captions: fade and band with the first, split with the
 * second (3.4 s). CSS animation only; the resting state is all three. */

const W = 270;
const H = 480;
const TOP = 120;
const XS = [50, 365, 680];

function Photo({ x, id }: { x: number; id: string }) {
  return (
    <g clipPath={`url(#${id})`}>
      <rect x={x} y={TOP} width={W} height={H} fill="url(#cvly-sky)" />
      <circle cx={x + 190} cy={TOP + 120} r={40} fill="#ffe9a8" />
      <path d={`M${x} ${TOP + 300} q 70 -90 140 -30 t 130 -50 v 260 h -270 z`} fill="#1f6f78" />
      <path d={`M${x} ${TOP + 370} q 90 -50 160 -10 t 110 -20 v 140 h -270 z`} fill="#174f58" />
    </g>
  );
}

function Frame({ x }: { x: number }) {
  return (
    <rect
      x={x}
      y={TOP}
      width={W}
      height={H}
      rx={22}
      fill="none"
      stroke="var(--border)"
      strokeWidth={3}
    />
  );
}

function Label({ x, name, use }: { x: number; name: string; use: string }) {
  return (
    <g>
      <text
        x={x + W / 2}
        y={TOP + H + 82}
        textAnchor="middle"
        fill="var(--foreground)"
        fontSize={60}
        fontWeight={700}
      >
        {name}
      </text>
      <text x={x + W / 2} y={TOP + H + 136} textAnchor="middle" fill="var(--support)" fontSize={34}>
        {use}
      </text>
    </g>
  );
}

function Headline({ x, y, fill }: { x: number; y: number; fill: string }) {
  return (
    <g fill={fill} fontSize={40} fontWeight={800}>
      <text x={x} y={y}>
        Ship it in
      </text>
      <text x={x} y={y + 46}>
        60 seconds
      </text>
    </g>
  );
}

export default function Layouts() {
  return (
    <div className="h-full w-full" style={{ background: "var(--card)" }}>
      <style>{`
        @keyframes cvly-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        .cvly-a, .cvly-b, .cvly-c { animation: cvly-in 0.6s ease-out both; }
        .cvly-a { animation-delay: 0.3s; }
        .cvly-b { animation-delay: 1.1s; }
        .cvly-c { animation-delay: 3.4s; }
      `}</style>
      <svg
        viewBox="0 0 1000 1000"
        className="h-full w-full"
        style={{ fontFamily: "var(--font-body)" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id="cvly-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff9a5a" />
            <stop offset="0.6" stopColor="#ffd08a" />
          </linearGradient>
          <linearGradient id="cvly-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.35" stopColor="#000" stopOpacity="0" />
            <stop offset="0.9" stopColor="#000" stopOpacity="0.88" />
          </linearGradient>
          {XS.map((x, i) => (
            <clipPath key={i} id={`cvly-clip-${i}`}>
              <rect x={x} y={TOP} width={W} height={H} rx={22} />
            </clipPath>
          ))}
        </defs>

        {/* fade: the picture fills the frame, the text sits over a dark fade */}
        <g className="cvly-a">
          <Photo x={XS[0]} id="cvly-clip-0" />
          <rect
            x={XS[0]}
            y={TOP}
            width={W}
            height={H}
            fill="url(#cvly-fade)"
            clipPath="url(#cvly-clip-0)"
          />
          <Headline x={XS[0] + 24} y={TOP + 372} fill="#ffffff" />
          <Frame x={XS[0]} />
          <Label x={XS[0]} name="fade" use="a photo" />
        </g>

        {/* band: the picture fills the frame, the text sits in a color band */}
        <g className="cvly-b">
          <Photo x={XS[1]} id="cvly-clip-1" />
          <rect
            x={XS[1]}
            y={TOP + 310}
            width={W}
            height={150}
            fill="var(--primary)"
            clipPath="url(#cvly-clip-1)"
          />
          <Headline x={XS[1] + 24} y={TOP + 372} fill="var(--primary-foreground)" />
          <Frame x={XS[1]} />
          <Label x={XS[1]} name="band" use="a busy photo" />
        </g>

        {/* split: the text on top, an app screenshot shown whole below */}
        <g className="cvly-c">
          <rect
            x={XS[2]}
            y={TOP}
            width={W}
            height={H}
            fill="var(--background)"
            clipPath="url(#cvly-clip-2)"
          />
          <Headline x={XS[2] + 24} y={TOP + 76} fill="var(--foreground)" />
          {/* the app screenshot: a phone screen with a header and rows */}
          <rect
            x={XS[2] + 58}
            y={TOP + 156}
            width={154}
            height={306}
            rx={18}
            fill="var(--muted)"
            stroke="var(--border)"
            strokeWidth={2}
          />
          <rect
            x={XS[2] + 74}
            y={TOP + 176}
            width={122}
            height={70}
            rx={10}
            fill="var(--primary)"
          />
          {[0, 1, 2, 3].map((i) => (
            <rect
              key={i}
              x={XS[2] + 74}
              y={TOP + 264 + i * 46}
              width={i % 2 ? 90 : 122}
              height={26}
              rx={8}
              fill="var(--muted-foreground)"
              opacity={0.45}
            />
          ))}
          <Frame x={XS[2]} />
          <Label x={XS[2]} name="split" use="a screenshot" />
        </g>
      </svg>
    </div>
  );
}
