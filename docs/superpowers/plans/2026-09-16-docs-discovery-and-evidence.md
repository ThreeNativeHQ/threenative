# Documentation discovery and evidence

**Status:** Implemented and locally component-checked; full repository gates remain unverified.

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
- [ ] Run the repository site typecheck, build, unit and browser suites. Blocked locally: no pnpm/dependency install; network resolution fails. The new Vitest/Playwright files are authored, not claimed to have run.
- [ ] Run Biome 1.9.4 formatting/lint checks. The binary is unavailable locally; this must be checked before merge.
- [ ] Publish the reviewed feature branch and open one PR to develop.

Exact repo verification commands:

```sh
pnpm --filter threenative-site typecheck
pnpm --filter threenative-site test
pnpm --filter threenative-site test:e2e
pnpm exec biome check site/src/content/docs.ts site/src/content/nav.ts \
  site/src/content/benchmarks.ts site/src/components/docs site/__tests__ site/e2e
```

**Environment limitation:** This session's working container cannot resolve GitHub or the npm
registry; a normal clone/install was attempted and failed. GitHub's connected API can read and
write the repository. Local tests therefore use inspected source files and the installed
TypeScript/Node tools; they are not a substitute for the repository's Vite/React/browser gates.
Do not label the PR ready or claim those gates passed without actual results.

## Executed checks (September 16, 2026)

- Strict TypeScript 5.8.3 compilation of docs/navigation/evidence pure modules: exit 0, including
  `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. This is not the pinned
  repository TypeScript 5.9.3 typecheck.
- Standalone Node behavior assertions: **21 passed, zero failed**. Baseline trailing-slash
  lookup/pagination produced two failing assertions before the fix.
- Isolated Chromium component checks: **10 passed, zero failed**. Covers five-engine/pair views,
  search navigation intent, shortcut/empty/Escape/focus restoration, Tab/Shift+Tab containment,
  ArrowDown, grouped mobile navigation, overflow at 320/390/768/1024/1440px, heading targets and
  active contents, adverse benchmark evidence, and no observed runtime page errors.
- Two keyboard defects were observed red and fixed: a populated search field consumed Escape;
  focus left the modal after the last Tab stop. Both passed after explicit Escape and boundary
  focus handling. Desktop comparison and mobile benchmark captures were visually inspected.

The isolated harness used locally available React/React DOM **19.1.1** and Tailwind **4.1.10**
with source components, not the repository's pinned versions or Vite build. It rendered only the
shared docs layout, comparison and benchmarks; the unchanged CopyButton and site header were
substituted and are not covered. Navigation assertions check link intent in the harness, not
production routing. No SSR/hydration, no-JavaScript build, full site Playwright, or full-monorepo
pass is claimed. Keep this pull request draft until the actual repository gates pass.
