# website — the public front door

Filed 2026-09-02. One PRD so far.

The site is a **private workspace app at `site/`**, not a package. `packages/*` in this repository
means published npm surface, and two live scripts fan out over it — `scripts/verify-golden-path.ts`
and `scripts/make-sandbox.ts` both run `pnpm --filter ./packages/** build` — so a website there is
compiled on every golden-path and sandbox run for nothing. Nothing will ever import the site.

| PRD | What it lands | Status |
| --- | --- | --- |
| [PRD-331](PRD-331-the-website-is-a-workspace-app.md) | `site/` — React 19 + Zustand + Tailwind v4, prerendered, deployed to Cloudflare by Wrangler, with a gate that fails when a marketing claim has no evidence and when the homepage code sample stops compiling | NOT STARTED |

The visual reference is `REFERENCE.png` at the repository root. Its design tokens are eyedropped
into the PRD, not guessed.

**The rule this batch is written around:** a marketing site is the only surface here with no
compiler behind it, so its claims and its code samples are typed artifacts the root suite runs.
No invented customer logo, no play button over a video that does not exist, no nav entry
pointing at a page that was never built.
