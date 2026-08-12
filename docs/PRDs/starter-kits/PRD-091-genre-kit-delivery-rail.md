---
prd_contract: v1
---

# PRD-091 — Adding a genre starter kit means editing six hardcoded lists, and the one that gates quality fails open

**Status: PROPOSAL, 2026-08-12.** Nothing has run. No platform readiness is claimed.
**Parent:** [PRD-087](./PRD-087-genre-borrow-ledger.md).
**Blocks:** [PRD-089](./PRD-089-shooter-starter-kit.md), [PRD-090](./PRD-090-racing-starter-kit.md),
[PRD-092](./PRD-092-strategy-starter-kit.md), [PRD-093](./PRD-093-action-rpg-starter-kit.md).
**Build this first.** Four genre kits behind a six-site registry is the same mistake four times.

**Complexity: 6 → HIGH mode.** One registry, one new Studio surface, no new package.

## 1. Why this is user value and not tidying

### The registry is six string literals and one of them is a silent gate

At `d54cb3b`, shipping a template means editing all of these:

| # | Site | What it controls |
|---|---|---|
| 1 | `packages/create-threenative/src/index.ts:7` | the `ScaffoldTemplate` union |
| 2 | `packages/create-threenative/src/index.ts:32` | `TEMPLATE_NAMES`, the runtime allowlist |
| 3 | `packages/create-threenative/src/index.ts:187` | `"Choose minimal, starter, or platformer."` |
| 4 | `packages/create-threenative/src/index.ts:232` | the same sentence again |
| 5 | `packages/create-threenative/src/index.ts:258` | `"Templates: minimal (smallest), starter (default), platformer."` |
| 6 | `scripts/visual-gate.ts:16` | a **second** `TEMPLATE_NAMES` — the one that decides whether the kit is verified at all |

Sites 3, 4 and 5 are prose that goes stale silently: the CLI would tell a user to choose from
three templates while offering seven. That is annoying.

**Site 6 is the actual defect.** `scripts/visual-gate.ts:161` and `scripts/verify-template-playtests.ts:23`
both iterate that hardcoded list. A template directory that exists on disk but is missing from
line 16 is **never structurally inspected, never visually scored, and never playtested — and
`pnpm test:templates` prints green.**

That is precisely the failure this repo names as its most dangerous: a check that reports
green while asserting nothing. v1 died of it. Adding four genre kits against a registry that
fails open is volunteering for it four more times.

### Studio cannot start a game, only continue one

`packages/studio/src/server.ts:746` resolves exactly one project and serves it:

```ts
const project = path.resolve(options.project ?? process.cwd());
```

The routes at `:808`–`:901` are `GET /`, `/api/status`, `/api/diff`, `/api/console`,
`/api/assets`, `POST /api/chat`, `/api/proof`, `/api/checkpoint`, `/api/restore`. **There is
no way to create anything.** Point Studio at an empty directory and it serves an IDE for a
game that does not exist.

So the live Studio — the surface this repo has been building as the place a user and their
agent actually work — cannot reach any genre kit we ship. The kits would be a CLI feature
that the flagship surface does not know exists.

### What "looks good" already means here, and why that is lucky

`scripts/visual-gate.ts` already encodes a quality bar that is not vibes. A template fails
structurally unless:

- `src/render/` contains `palette.ts`, `camera.ts`, `sky.ts`, `lighting.ts`, `materials.ts`
  and `postprocessing.ts` (`RENDER_LAYER_FILES`, `:22`), **each with a live importer**;
- `palette.ts` exports at most 6 named colours with **exactly one** `accent` role;
- `materials.ts` and `sky.ts` both import `palette.js`;
- `lighting.ts` has **two** `DirectionalLight`s (key and rim), a hemisphere or ambient fill,
  `PCFSoftShadowMap` and `normalBias`;
- `postprocessing.ts` has `toneMapping`, `toneMappingExposure`, `setOutputNode` and `bloom(`.

Then a blind 1–5 score must clear `VISUAL_SCORE_FLOOR = 4` (`:29`, enforced `:199`).

**"Each kit should look good" therefore needs no new machinery and no new opinion.** It needs
the kit to be in the list at site 6. This PRD's job is to make that impossible to forget.

## 2. Solution

### One manifest, six sites collapse to it

A single `packages/create-threenative/templates/<name>/kit.json` per kit, and one loader that
discovers them by reading the templates directory:

```jsonc
{
  "name": "shooter",
  "title": "Arena shooter",
  "blurb": "Hitscan and projectile weapons, targets that hunt you, pickups on a timer.",
  "genre": "shooter",
  "kit": true          // false for minimal/starter: scaffoldable, not offered as a genre
}
```

- `ScaffoldTemplate` becomes the discovered set; sites 1–2 derive from disk.
- Sites 3–5 are generated from the manifests, so the CLI's own help can never be stale.
- **Site 6 inverts.** `visual-gate.ts` stops carrying a list and instead enumerates the
  templates directory, then asserts the discovered set is non-empty. A kit on disk is gated
  by existing; a kit that vanishes fails loudly instead of quietly shrinking the gate.

**This is the fail-closed change, and it is the reason this PRD exists.** Everything else is
convenience.

### Studio's empty-directory state becomes the genre picker

Two routes, and one of them is a wrapper:

- `GET /api/kits` — the manifests with `kit: true`, plus a preview image per kit (the PNG the
  visual gate already writes to `VISUAL_ROOT`, so the picker shows the *gated* screenshot, not
  hand-made marketing art that can drift from the build).
- `POST /api/kits/create` — `{ kit }`, scaffolds into Studio's own project directory, **by
  calling `createProject()` from `create-threenative`**.

No second scaffolding path. Studio importing the CLI is the whole design: a fork here would be
a genre kit that boots in Studio and not from `npx`, which is exactly the class of divergence
this repo forbids between its two targets.

`app.tsx` gains one state: when the project directory is empty, the Game view renders the kit
picker instead of a dead preview. There is no new tab, no new mode, no settings page. Pick a
kit, it scaffolds, the existing live preview boots it, and Studio is in the state it already
knows how to be in.

### Rejected in writing

- **A kit marketplace / registry / download flow.** Kits ship in the package. No network.
- **A "kit" concept in `@threenative/core`.** A kit is a directory of generated user source and
  a manifest. Nothing in the framework knows the word.
- **Per-kit framework options in `defineGame`.** Rule 3. A kit that needs a `genre: "shooter"`
  flag has put gameplay in the framework.
- **Hand-authored preview images.** They drift from the build and the drift is invisible. The
  gate's own capture is the preview or there is no preview.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `kit.json` + manifest loader | `packages/create-threenative/src/index.ts` | sites 1–5, six hardcoded literals | **yes** — all five deleted | add a kit directory without touching any `.ts`; `--template <kit>` must work |
| 2 | Directory-driven gate enumeration | `scripts/visual-gate.ts:16`, `scripts/verify-template-playtests.ts:23` | the second hardcoded `TEMPLATE_NAMES` | **yes** | drop a template directory in with a broken `palette.ts`; `pnpm test:templates` must go **red without anyone registering it** |
| 3 | `GET /api/kits` | `packages/studio/src/server.ts` | nothing — Studio could not enumerate anything | n/a | remove a `kit.json`; the picker must lose that card |
| 4 | `POST /api/kits/create` → `createProject()` | `packages/studio/src/server.ts` | Studio's inability to start a project | n/a | make Studio scaffold by copying files itself → CLI and Studio outputs diverge, and the parity test catches it |
| 5 | Empty-project picker state | `packages/studio/src/app.tsx` | a dead preview pane on an empty directory | **yes** | point Studio at an empty dir; the picker must render, not an error |
| 6 | `kits.*` probe checks | `scripts/studio-probe.ts` | no probe line covers kits | n/a | delete a check; the probe's own "assertions were removed" guard fires |

Row 2 is the one that matters. **If a deliberately broken, unregistered template does not turn
`pnpm test:templates` red, this PRD failed regardless of what else landed.**

## 4. Execution phases

### Phase 0 — Prove the gate currently fails open

**Outcome:** a recorded run showing a template directory with a missing `postprocessing.ts`
sitting on disk while `pnpm test:templates` exits 0.

**Why first:** the defect in §1 is read from source, not executed. If the gate turns out to
already catch it, sites 1–5 are ergonomics and this PRD drops to LOW mode. Measure, then
design. **Gate:** the exit code and output land in `docs/verification/`.

### Phase 1 — The manifest and the fail-closed gate

**Outcome:** `kit.json` per template, discovery replaces sites 1–6, and the Phase 0 broken
template now fails.

**Gate:** the Phase 0 reproduction, re-run, must exit non-zero with a structural error naming
the missing file. `pnpm typecheck && pnpm lint && pnpm test` green.

### Phase 2 — Studio picker

**Outcome:** `--project` on an empty directory renders the kit picker; choosing one scaffolds
through `createProject()` and the live preview boots it.

**Gate:** `pnpm studio:probe --browser` green, including new `kits.listed`,
`kits.create.scaffolds` and `kits.create.boots` checks. A parity assertion that the Studio
path and the `npx` path produce byte-identical trees for the same kit.

### Phase 3 — Ship the four kits through the rail

**Outcome:** PRD-089, 090, 092 and 093 each add a directory and a `kit.json` and nothing else.

**Gate:** each kit's own acceptance criteria. **If any of them needs to edit the CLI or the
gate script, this PRD did not finish** — that is the test of whether the rail is real.

## 5. Verification strategy

- **The gate is tested by breaking it, not by passing it.** Phase 1's acceptance is a red run
  on a deliberately broken template that nobody registered. A green run proves nothing here,
  because green is what the broken state already produces.
- **The probe's own removal guard is the meta-check.** `scripts/studio-probe.ts:51` already
  refuses a check count that went down. New `kits.*` checks inherit that.
- **CLI/Studio parity is asserted as a tree diff**, not by eyeballing both. Two scaffolds of
  the same kit, one per path, compared file-for-file.
- **The picker's preview images come from `VISUAL_ROOT`.** If the visual gate has not captured
  a kit, its card has no image — a missing picture is the visible symptom of an ungated kit,
  which is the right way round.
- **Studio checks run with `--browser`**, and anything visual runs under
  `xvfb-run -a -s '-screen 0 1600x900x24'`, because headless Chromium renders WebGPU blank on
  this machine and a blank canvas has passed a screenshot assertion here before.

## 6. Acceptance criteria

- [ ] All six sites in §1 are gone; adding a kit is adding a directory with a `kit.json`.
- [ ] A broken template that appears in no list turns `pnpm test:templates` **red**, and the
      Phase 0 recording shows it was green before.
- [ ] `npx create-threenative --template <kit>` works for every kit, and the CLI's own help
      text is generated, never typed.
- [ ] Studio on an empty directory shows the kit picker; choosing a kit scaffolds it and the
      live preview boots it, with `kits.*` checks in `pnpm studio:probe --browser`.
- [ ] Studio and the CLI produce byte-identical trees for the same kit, asserted.
- [ ] No line was added to `@threenative/core`, `physics` or `ui`. `@threenative/studio` gains
      one dependency — `create-threenative` — and that is stated, not incidental.
- [ ] Kit preview images in the picker are the visual gate's own captures.
- [ ] `pnpm budgets` delta reported; any review trigger crossed is justified in this file.
