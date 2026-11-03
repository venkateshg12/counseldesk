/*
  The "3D decorative objects" of DESIGN-krepling.md: soft pastel spheres and rounded cubes floating on
  white. Pure SVG, no images. A sphere is a radial gradient whose focal point is pushed up and to the
  left (the highlight); a cube is three isometric faces in light, mid and dark tints, each stroked in
  its own colour with round joins, which rounds the corners. Artwork only: aria-hidden, never UI.
 */
type Sphere = { kind: "sphere"; x: number; y: number; r: number; hue: string };
type Cube = {
  kind: "cube";
  x: number;
  y: number;
  s: number;
  tones: [string, string, string]; // top, left, right
};

// [highlight, base, shade] per pastel.
const HUES = {
  lavender: ["#f1eaff", "#b9a4ff", "#8d74e8"],
  butter: ["#fff8d6", "#ffe07a", "#f1bf3d"],
  sky: ["#e4f3ff", "#86c8ff", "#52a1e6"],
  coral: ["#ffe6e0", "#ff8f7a", "#ec6a52"],
  mint: ["#e3fbf1", "#8de4c4", "#4fc79f"],
  pink: ["#ffe8f3", "#ff9fcb", "#ea6fa6"],
} as const;

const HERO: (Sphere | Cube)[] = [
  { kind: "sphere", x: 330, y: 230, r: 118, hue: "lavender" },
  {
    kind: "cube",
    x: 150,
    y: 350,
    s: 82,
    tones: ["#ffc2b5", "#ff8f7a", "#e9684f"],
  },
  { kind: "sphere", x: 505, y: 92, r: 56, hue: "butter" },
  {
    kind: "cube",
    x: 478,
    y: 372,
    s: 66,
    tones: ["#b9f1dc", "#8de4c4", "#52c9a1"],
  },
  { kind: "sphere", x: 108, y: 132, r: 40, hue: "sky" },
  {
    kind: "cube",
    x: 292,
    y: 452,
    s: 38,
    tones: ["#ffd0e6", "#ff9fcb", "#e8699f"],
  },
];

const SMALL: (Sphere | Cube)[] = [
  { kind: "sphere", x: 140, y: 110, r: 70, hue: "sky" },
  {
    kind: "cube",
    x: 300,
    y: 130,
    s: 52,
    tones: ["#ffe9a0", "#ffe07a", "#ecbb3a"],
  },
  { kind: "sphere", x: 230, y: 40, r: 26, hue: "pink" },
];

const iso = (x: number, y: number, s: number) => {
  const w = s * 0.866;
  const h = s * 0.5;
  const pt = (px: number, py: number) => `${x + px},${y + py}`;
  return {
    top: [pt(0, -s), pt(w, -h), pt(0, 0), pt(-w, -h)].join(" "),
    left: [pt(-w, -h), pt(0, 0), pt(0, s), pt(-w, h)].join(" "),
    right: [pt(0, 0), pt(w, -h), pt(w, h), pt(0, s)].join(" "),
  };
};

export function Decor({
  variant = "hero",
  className,
}: {
  variant?: "hero" | "small";
  className?: string;
}) {
  const shapes = variant === "hero" ? HERO : SMALL;
  const box = variant === "hero" ? "0 0 600 520" : "0 0 360 200";
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={box}
      className={className}
    >
      <defs>
        {shapes.map((shape, i) =>
          shape.kind === "sphere" ? (
            <radialGradient
              key={`g${i}`}
              id={`${variant}-sphere-${i}`}
              cx="50%"
              cy="50%"
              r="55%"
              fx="32%"
              fy="26%"
            >
              <stop
                offset="0"
                stopColor={HUES[shape.hue as keyof typeof HUES][0]}
              />
              <stop
                offset="0.55"
                stopColor={HUES[shape.hue as keyof typeof HUES][1]}
              />
              <stop
                offset="1"
                stopColor={HUES[shape.hue as keyof typeof HUES][2]}
              />
            </radialGradient>
          ) : null,
        )}
        <filter
          id={`${variant}-soft`}
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      {shapes.map((shape, i) => {
        if (shape.kind === "sphere") {
          return (
            <g key={i}>
              <ellipse
                cx={shape.x + shape.r * 0.1}
                cy={shape.y + shape.r * 1.12}
                rx={shape.r * 0.7}
                ry={shape.r * 0.12}
                fill="#000"
                opacity="0.12"
                filter={`url(#${variant}-soft)`}
              />
              <circle
                cx={shape.x}
                cy={shape.y}
                r={shape.r}
                fill={`url(#${variant}-sphere-${i})`}
              />
            </g>
          );
        }
        const faces = iso(shape.x, shape.y, shape.s);
        const stroke = Math.max(6, shape.s * 0.14);
        return (
          <g key={i}>
            <ellipse
              cx={shape.x}
              cy={shape.y + shape.s * 1.2}
              rx={shape.s * 0.8}
              ry={shape.s * 0.13}
              fill="#000"
              opacity="0.12"
              filter={`url(#${variant}-soft)`}
            />
            {(["top", "left", "right"] as const).map((face, f) => (
              <polygon
                key={face}
                points={faces[face]}
                fill={shape.tones[f]}
                stroke={shape.tones[f]}
                strokeWidth={stroke}
                strokeLinejoin="round"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
