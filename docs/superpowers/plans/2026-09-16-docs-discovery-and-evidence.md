# Documentation discovery and evidence

**Status:** Implemented and repository-verified on the pinned stack; acceptance complete.

**Goal:** Improve the existing public docs portal on develop, including the five-engine comparison
and benchmarks, without adding top-level navigation items.

**Architecture:** Retain the existing React/Vite prerendered routes and shared docs layout. The
current develop branch already contains eight React-authored guides, a comparison and benchmark
content; extend those instead of installing another documentation stack. Search the typed page
metadata locally. Keep historical measurements in a small typed, commit-pinned evidence module.

**Scope:** Website only. No framework, runtime, package, lockfile or deployment changes. Existing
URLs and prerendering remain intact. No new runtime dependencies or externally hosted search.

## 1. Discovery and navigation

- [x] Reproduce trailing-slash lookup and pagination drift against the inspected docs registry.
  Two standalone Node assertions failed on the existing implementation.
- [x] Normalize document lookup consistently with the route table; cover lookup and pagination.
- [x] Add `searchDocs(query)` to the metadata registry. Match every whitespace-separated term,
  ignore case, rank labels before prose, return stable results, preserve the registry's order.
- [x] Add one native-dialog search control to the shared docs layout, available on desktop and
  mobile, with Ctrl/Cmd+K, Escape, keyboard focus, an explicit empty state and real result links.
- [x] Replace the horizontally scrolling mobile pill list with a grouped, native details menu.
- [x] Add heading permalinks, responsive page contents, active-section state and edit links.
- [x] Remove disabled Solutions/Pricing links. Keep Product, Docs and Community; comparison and
  benchmarks remain within Docs. Preserve the existing home install/code anchors.

Files: `site/src/content/docs.ts`, `site/src/content/nav.ts`,
`site/src/components/docs/DocsSearch.tsx`, `DocsToc.tsx`, `DocsLayout.tsx`.

## 2. Comparison and benchmark evidence

- [x] Add an accessible two-engine comparison selector while retaining the all-five default view.
- [x] Add row/column scopes, a table caption and a keyboard-scrollable comparison region.
- [x] Clarify Godot's C/C++ extension route; retain official primary-source links.
- [x] Pin benchmark links to inspected commit `8c182343fe0be71131420dc79bd80bd6c7c8c17c`.
- [x] Compute ratios and reductions from numeric source data instead of duplicating percentages.
- [x] Show all three shader census columns: original, tint uniforms, tint plus stable buffer names.
- [x] Preserve adverse evidence: Pixel did not reach the one-third program-reduction target,
  readiness still failed 8,000 ms, and AC-charging disqualifies qualified timing claims.
- [x] State the AutoLOD proof's opt-in, platform and incomplete quality/frame-time/default-on scope.
- [x] Explicitly mark Godot, Unity and Unreal matched runtime comparisons as not measured, not zero.
- [x] Keep the agent-vs-agent experiment visibly VOID and provide reproducibility/source pointers.

Files: `site/src/components/docs/Comparison.tsx`, `Benchmarks.tsx`,
`site/src/content/benchmarks.ts`.

## 3. Verification and delivery

- [x] Run strict TypeScript checks and standalone Node assertions for pure registry/evidence logic.
- [x] Add Vitest assertions for navigation, ratios, metadata and prerendered evidence.
- [x] Add Playwright coverage for search, keyboard dismissal, mobile navigation, comparison filters,
  heading anchors, no-JavaScript content and horizontal-overflow containment.
- [x] Run the repository site typecheck, build, unit and browser suites. Site workflow
  `35133850851` passed `typecheck`, `test`, `test:e2e` and the deployment dry-run on the feature
  source head. CI run `35133851395` separately passed the website typecheck, production build,
  Vitest suite and Playwright suite.
- [x] Run Biome 1.9.4 formatting/lint checks. CI run `35133851395` passed the repository lint lane;
  `pnpm lint` executed `biome check .` with no errors or fixes required. Existing complexity
  diagnostics elsewhere in the repository remained warnings only.
- [x] Publish the reviewed feature branch and open one PR to develop. PR #268 targets `develop`.

Exact repo verification commands:

```sh
pnpm --filter threenative-site typecheck
pnpm --filter threenative-site test
pnpm --filter threenative-site test:e2e
pnpm exec biome check site/src/content/docs.ts site/src/content/nav.ts \
  site/src/content/benchmarks.ts site/src/components/docs site/__tests__ site/e2e
```

The local working container could not resolve GitHub or the npm registry, so its isolated checks were
never treated as repository acceptance. Hosted CI supplied the missing pinned dependency install and
real repository execution. The feature branch was subsequently synchronized mechanically with
`develop` after #258 landed; that sync touched no docs/site source. Fresh current-base CI is still
required before merge because the merge commit changes the candidate SHA even though the feature
files are byte-identical.

## Executed checks (September 16, 2026)

- Strict TypeScript 5.8.3 compilation of docs/navigation/evidence pure modules: exit 0, including
  `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Standalone Node behavior assertions: **21 passed, zero failed**. Baseline trailing-slash
  lookup/pagination produced two failing assertions before the fix.
- Isolated Chromium component checks: **10 passed, zero failed**. Covers five-engine/pair views,
  search navigation intent, shortcut/empty/Escape/focus restoration, Tab/Shift+Tab containment,
  ArrowDown, grouped mobile navigation, overflow at 320/390/768/1024/1440px, heading targets and
  active contents, adverse benchmark evidence, and no observed runtime page errors.
- Hosted site workflow `35133850851`: pinned install, site typecheck, site unit suite, Playwright
  E2E and Cloudflare dry-run all passed.
- Hosted CI `35133851395`: documentation/evidence gates, repository Biome lint, site typecheck,
  production build, Vitest and Playwright all passed; `ci-required` passed.
- The Playwright docs suite drives the real header-to-docs navigation, the 390 px grouped mobile
  docs menu, the global mobile-nav toggle, search keyboard behavior, comparison filters, heading
  anchors, overflow containment and a JavaScript-disabled prerendered comparison/benchmark path.
  That closes the earlier header/mobile/prerender integration reservation on the pinned stack.
- Two keyboard defects were observed red and fixed: a populated search field consumed Escape;
  focus left the modal after the last Tab stop. Both passed after explicit Escape and boundary
  focus handling. Desktop comparison and mobile benchmark captures were visually inspected.

The earlier isolated React 19.1.1/Tailwind 4.1.10 harness remains useful red/green evidence only.
Repository acceptance comes from the successful pinned-stack hosted runs above. No matched runtime
benchmark for Godot, Unity or Unreal is claimed, and the VOID agent experiment remains VOID.
