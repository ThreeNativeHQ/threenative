# Image provenance

Every image this site ships, and where it came from. An entry here is a licence check that was
actually done, not an intention to do one.

| File | Origin | Licence |
| --- | --- | --- |
| `public/favicon.svg` | Drawn for this repository | MIT, with the rest of the repository |
| `public/og/home.svg` | Drawn for this repository | MIT, with the rest of the repository |
| Hero art (`.tn-hero-art` in `src/styles/tailwind.css`, `src/components/sections/HeroArt.tsx`) | Drawn for this repository as CSS gradients and a deterministic star lattice; no raster asset | MIT, with the rest of the repository |

## What is deliberately absent

`REFERENCE.png` at the repository root is the approved visual *comp*. The photoreal spacecraft
render and the eight customer logos in it are mock-ups, not licensed assets, so neither ships:

- The hero art is original, drawn in CSS and SVG. It matches the comp's palette and composition
  without carrying someone else's render.
- `src/content/logos.ts` is empty and `LogoWall` returns `null`, so no logo wall renders. An entry
  is added only when written permission exists and is named in its `permission` field.
- The showcase card has no play button, because there is no recording to play.
