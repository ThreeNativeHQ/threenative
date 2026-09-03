/**
 * Original artwork, drawn rather than photographed: a planet limb and its atmospheric rim, built
 * from SVG gradients plus a deterministic star lattice. The comp in `REFERENCE.png` is a mock, not
 * a licence, so nothing photoreal ships here. Provenance is in `public/og/CREDITS.md`.
 *
 * It is `aria-hidden`, carries no animation and no raster asset, and is sized entirely by its
 * container, so it can neither shift layout nor move under `prefers-reduced-motion`.
 */
const STARS = Array.from({ length: 90 }, (_unused, index) => {
  // A golden-ratio lattice: deterministic, so the prerendered and hydrated markup agree exactly.
  const phi = (index * 0.6180339887) % 1;
  return {
    cx: Number((phi * 100).toFixed(2)),
    cy: Number((((index * 29) % 71) / 71) * 82 + 1),
    o: Number((0.16 + ((index % 5) / 4) * 0.62).toFixed(2)),
    r: index % 9 === 0 ? 0.17 : 0.09,
  };
});

export function HeroArt({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={["pointer-events-none block", className].filter(Boolean).join(" ")}
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 100 68"
    >
      <defs>
        <radialGradient cx="62%" cy="14%" id="tn-space" r="78%">
          <stop offset="0%" stopColor="#0f1730" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#050a16" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#020407" stopOpacity="0" />
        </radialGradient>
        <radialGradient cx="30%" cy="12%" id="tn-planet" r="76%">
          <stop offset="0%" stopColor="#1d2740" />
          <stop offset="32%" stopColor="#111827" />
          <stop offset="66%" stopColor="#070b13" />
          <stop offset="100%" stopColor="#04060a" />
        </radialGradient>
        <linearGradient id="tn-terminator" x1="10%" x2="78%" y1="0%" y2="70%">
          <stop offset="0%" stopColor="#ffcb92" stopOpacity="0.62" />
          <stop offset="14%" stopColor="#d4813f" stopOpacity="0.34" />
          <stop offset="38%" stopColor="#3b2b34" stopOpacity="0.14" />
          <stop offset="70%" stopColor="#04060c" stopOpacity="0" />
        </linearGradient>
        <radialGradient cx="50%" cy="50%" id="tn-halo" r="50%">
          <stop offset="86%" stopColor="#ffb974" stopOpacity="0" />
          <stop offset="96%" stopColor="#ffcb96" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#8fb4ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="tn-left" x1="0%" x2="46%" y1="0" y2="0">
          <stop offset="0%" stopColor="#020407" stopOpacity="1" />
          <stop offset="100%" stopColor="#020407" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="tn-fade" x1="0" x2="0" y1="62%" y2="100%">
          <stop offset="0%" stopColor="#020407" stopOpacity="0" />
          <stop offset="100%" stopColor="#020407" stopOpacity="0.92" />
        </linearGradient>
      </defs>

      <rect fill="#020407" height="68" width="100" x="0" y="0" />
      <rect fill="url(#tn-space)" height="68" width="100" x="0" y="0" />
      {STARS.map((star) => (
        <circle
          cx={star.cx}
          cy={star.cy}
          fill="#ffffff"
          fillOpacity={star.o}
          key={`${star.cx}-${star.cy}`}
          r={star.r}
        />
      ))}
      <circle cx="76" cy="118" fill="url(#tn-halo)" r="80" />
      <circle cx="76" cy="118" fill="url(#tn-planet)" r="74" />
      <circle cx="76" cy="118" fill="url(#tn-terminator)" r="74" />
      <circle
        cx="76"
        cy="118"
        fill="none"
        r="74"
        stroke="#ffd7a6"
        strokeOpacity="0.55"
        strokeWidth="0.35"
      />
      <rect fill="url(#tn-fade)" height="68" width="100" x="0" y="0" />
      <rect fill="url(#tn-left)" height="68" width="100" x="0" y="0" />
    </svg>
  );
}
