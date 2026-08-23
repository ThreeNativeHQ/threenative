---
prd_contract: v1
---

# PRD-133 — Three published packages render as blank pages on npm

**Status: COMPLETE, 2026-08-22.** The three package READMEs, tarball inclusion and the README
guard landed 2026-08-18. Criterion 1 went green when the five packages whose published versions
had drifted moved to the 0.3.0 line with their sibling peer ranges, and the publishable but
never-named `threenative-engine-mcp` joined the release workflow's publish set.
Record:
[`docs/verification/prd-133-package-readmes-2026-08-17.md`](../../verification/prd-133-package-readmes-2026-08-17.md)

**Outcome:** every package this repository publishes arrives on npm with a README that says what
it is, what it depends on, and one runnable example — and `pnpm publish:check` refuses a tree
where one is missing or would not be included in the tarball.

**Depends on:** nothing. `LICENSE` and the `license` fields landed with PRD-129.

**Blocks:** nothing.

**Complexity: 3 → LOW mode.** Three documents and one guard. The judgement is in the prose.

**Blast radius: 7 files.** `packages/{core,ui,runtime-native}/README.md`,
`packages/{core,ui}/package.json` (`files`), `scripts/check-publish-state.ts`, one spec.

---

## 1. Evidence

Read off the tree on 2026-08-17:

| Package | `README.md` | `files` | Would a README ship? |
| --- | --- | --- | --- |
| `@threenative/core` | **missing** | `["dist"]` | **no — even if written** |
| `@threenative/ui` | **missing** | `["dist"]` | **no — even if written** |
| `@threenative/runtime-native` | **missing** | 24-entry explicit list | **no — not listed** |
| `@threenative/create-threenative` | present | — | yes |
| `@threenative/physics` | present | — | yes |
| `@threenative/playtest` | present | — | yes |

Two separate defects stacked on the same packages. `core` and `ui` have no README **and** a
`files` list that would not carry one. `runtime-native` enumerates 24 paths and none of them is a
README. So writing the three documents without touching `files` fixes nothing visible: the npm
page stays blank.

`@threenative/core` is the package every scaffolded project installs first. Its page is where a
stranger who found the framework through npm rather than through this repository lands.

## 2. What each README must contain

Short. Four sections, no more — this is a package page, not the docs site.

1. **One paragraph: what the package is and what it is not.** For `core`: the plumbing
   (`defineGame`, nodes, scenes, state, the build command) and explicitly *not* the look.
2. **Install**, with the peer dependency spelled out (`three`, and `react` for `ui`).
3. **One example that runs**, copied from a template's real source rather than invented.
4. **Links**: repository, `LICENSE`, and `pnpm create threenative`.

`runtime-native`'s must additionally say, in its first paragraph, that native compilation is
opt-in and that installing the package does not require CMake, an NDK, or Xcode — that is the
question its page will actually be opened to answer.

**Write these by hand and read them before landing.** Three package front pages are the one
deliverable in this batch that is judgement rather than mechanics.

## 3. The guard

`scripts/check-publish-state.ts` gains a fourth question to its existing three, at the same
severity and failing closed the same way:

> does every publishable package carry a `README.md` that its own `files` list would include?

Implemented against the manifest, not against `npm pack` output, so it runs offline. A package
whose `files` is absent (everything ships) passes on the file's existence alone; a package with an
explicit `files` must match the README through one of its entries.

## 4. Acceptance

| # | Command | Required result |
| --- | --- | --- |
| 1 | `pnpm publish:check` | exit `0` |
| 2 | delete `packages/core/README.md`, re-run #1 | **fails**, naming `@threenative/core` |
| 3 | restore it, set `packages/core` `files` back to `["dist"]`, re-run #1 | **fails**, naming the `files` list |
| 4 | `pnpm --filter @threenative/core exec npm pack --dry-run` | `README.md` present in the listed contents |
| 5 | `pnpm test` | exit `0` |

Steps 2 and 3 prove the two halves of the defect are each caught. Step 4 is the only one that
proves the tarball, and it is cheap.

Evidence file: `docs/verification/prd-133-package-readmes-2026-08-17.md`, with #4's output pasted
for all six packages.

## 5. What this does not claim

**Not that the npm pages are good.** Nobody outside this project has read one, and whether a
package page makes a stranger install anything is unmeasurable here — that is PRD-080, blocked on
a person. This PRD only ends the state where the page is empty.

Republishing is **out of scope**. The versions on npm keep their blank pages until the next
release goes out through `pnpm release`; this PRD changes what the *next* publish carries.
