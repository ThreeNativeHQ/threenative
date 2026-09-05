# docs/PRDs/assets

The asset flow: how bytes get **into** a game (ingest) and how they get **to a player** (cook).
Read `/AGENTS.md` and `docs/PRDs/AGENTS.md` first.

## The one distinction these PRDs turn on

```
   Unreal pack                 your repo                     the player
        │                          │                              │
        │  ① INGEST                │  ② COOK                      │
        │  (once, your machine)    │  (every build, ships)        │
        ▼                          ▼                              ▼
   .uasset  ─────────────────►  assets/  ──────────────────►   public/
             converter                      compile step
```

`.uasset`→`.glb` conversion and direct `.uasset` loading answer ①. Compression, dedupe and mips are
②. **Every shipped byte is decided in ②.** Confusing the two is what produced a 289 MB scene.

## Order of execution

| PRD | Wins | Depends on |
|---|---|---|
| **[349 — the cook is on by default](../done/PRD-349-the-cook-is-on-by-default.md)** | DONE: Wildwood 304.92 → 51.33 MB, Quarry 29.89 → 4.57 MB; iOS waived | — |
| **350 — the platform gate knows which passes need a decoder** | 289 MB → ~83 MB on Android/iOS | 349 |
| **351 — compression never looks worse than a floor** | quality floor + the 2048² resolution raise | 349 |
| **352 — Unreal ingest is first-party** | **zero shipped bytes** — removes an external repo from the ingest path | none |

**349 first, always.** It is the one that fixes every game scaffolded from here on. 352 is
independent and is not a size win; anyone prioritizing it for bytes has misread it.

## Measured evidence, once, so no PRD re-derives it

From `sandbox/wildwood` at `d535f51`, 2026-09-04. Full record:
`docs/verification/PRD-349-assumption-spike.md`.

| | |
|---|---|
| wildwood load set, one scene | **289 MB** |
| — embedded PNG in 56 flora GLBs | 259 MB |
| — of which distinct (39 images, 33.3 MP) | 52.7 MB |
| — pure duplication | **206 MB** |
| — geometry + animation, all 56 models | **5.7 MB (0.5-3.4% of each file)** |
| the same 56 meshes + 51 textures as uncooked `.uasset` | **754 MB** |
| **spike: 6 real pines through the cook** | **55.2 MB → 4.97 MB (−90.6%)**, SSIM 0.969-0.990, 0 resized |

## Findings that changed a plan

- **Explicit `needSupercompression:true` gains 0.0% over omission.** Execution found why:
  `ktx2-encoder@0.6.0` already defaults it to true. Both spike arms used Zstd; the result does
  not show that Zstd needs RDO. The phase stays cut and the existing default is preserved.
- **`chooseCodec` picks `uastc` for everything** in this pack — the diffuse maps carry cutout alpha,
  so ETC1S never fires. Remaining headroom is RDO, which is why 351 exists.
- **The platform matrix was already solved** (`compile.ts:210-224`); the templates' `"none"` is a
  fossil of the era before it, and the engine's own comment says so.
- **`quantize` needs no decoder** — `runtime-native/scripts/bundle.mjs` stubs only Basis, Meshopt
  and Draco.
- **`raw-unreal` reads this pack**: 61/62, and 58/58 vertex-exact against the external importer.
  wildwood's procedural-foliage workaround was unnecessary; its note is corrected in place.
- **Uncooked `.uasset` textures are `TSF_BGRA8`, PNG-wrapped** — so a first-party texture reader is
  small, not the bulk of 352.

## Decisions taken, so they are not relitigated

| Decision | Where | Why |
|---|---|---|
| the `.uasset`→`.glb` converter stays | 349 §1 | geometry is 0.5-3.4% of the bytes; no ingest path touches the other 97% |
| `assets.budget` gates **uncooked** bytes (default 64 MB), not total | 349 §3 | games differ by 100×; the defect is "large **and** uncooked", and an absolute cap cannot express that |
| `maxTextureSize` default → **2048**, masks stay 1024 | 351 §2B | with duplication gone, 4× the pixels still lands 3.4× smaller than today |
| quality floor **SSIM ≥ 0.95, ΔE00 ≤ 3.0** | 351 §2A | today's measured minimum is 0.9689, so the floor cannot silently degrade an existing game |
| RDO ships behind the floor, one-day timebox on its crash | 351 Phase 2 | the floor and the escalation are the architecture; RDO is one rung on it |
| skeletal goes to `ueformat`, not `raw-unreal` | 352 §4 | `ueformat` already reads skin weights and morphs; `raw-unreal` throws on skeletal by design |
| the external importer is **kept**, not deprecated | 352 §4 | it owns cooked/IoStore packs, which `raw-unreal` explicitly refuses — disjoint scopes, not duplication |
| the material library stays per-pack **data** | 352 §4 | charter rule 2: it decides how things look, so a game owns it; the engine owns only the slot←parameter mechanism |

## Still open, and owned

| Question | Owner |
|---|---|
| a browser rendering a cooked GLB end to end — never yet done | 349 Phase 4 (`quarry`), and it must be a real render, not a structural assertion |
| whether wildwood can build for Android *at all* today | 350 Phase 1, one command |

---

## Traps that have already cost someone a day

Verified live against `main` on 2026-09-04. Each names the file that still enforces it, so a stale
entry is falsifiable rather than folklore.

### Bites PRD-349 first, because turning the cook on changes who gets passes

- **An empty pass chain hangs `threenative build`.** `packages/assets/src/worker-pool.ts:85` spins
  up a `Worker` unconditionally, and `compile.ts` has **no** `passes.length === 0` guard — grep it
  and see. A template resolving to zero passes (today: `assets: "none"`) starts a pool that never
  drains. 349 changes which templates get a non-empty chain, so it owns this either way: add the
  guard, or make sure no template can land on the empty path.
- **Every compressed source texture must be width- and height-divisible by 4.** BC7, BC1, ETC2 and
  ASTC all use 4×4 blocks. Documented as a `@constraint` at `packages/assets/src/index.ts:88` and
  `passes/texture.ts:78`. The failure is nasty: the pipeline reports **0 fail**, and WebGPU rejects
  the texture at *draw* time. Use a `codec: "none"` override for an intentionally unaligned one.
- **Validate the config seam producer→consumer, not each side.** `assets.models.virtual` was once
  accepted by one layer and rejected by the next, and both layers' tests passed. A round trip
  through the real config path is the only test that catches it.

### Bites PRD-349 Phase 4 — the browser render that has never been done

- **Headless Chromium cannot capture WebGPU.** You get a white screenshot and a correct DOM, which
  reads as a pass to anything checking structure. Capture *headed*. This is exactly why the README
  says Phase 4 must be a real render, not a structural assertion.
- **Prefer a numeric probe to a capture.** `playtest doctor` and an assertion beat a screenshot; a
  capture is the last resort, not the first.
- **`vite` needs `--host 127.0.0.1`** on this machine, and a WebGPU run that cannot name its
  adapter may be SwiftShader — use `--browser-recipe webgpu` and check `adapter.info`.

### Bites PRD-352

- **`asset_import_unreal` runs from a prebuilt `sandbox/.mcp-tools/`.** Committing an importer fix
  does not change what agents actually invoke. Rebuild that, or you will test the old binary.
- **A scaffolded game cannot resolve the Unreal packages.** `capabilities.json` advertises
  `raw-unreal`/`ueformat` symbols, and the starter template's `package.json` names neither —
  verified, 0 references. Anything 352 tells a game to import has to arrive through the scaffold.
- **The ground-truth corpus is a separate repo** with `umodel` and the fab packs cached locally, so
  coordinate and vertex claims are measurable rather than argued. Bump `IMPORTER_VERSION` when the
  reader changes.

### Bites any of them, because they all write evidence

- **`docs/verification/` now has a retention policy with a gate** (PRD-323, landed 2026-09-04).
  Evidence is kept by *citation*, not age; there are byte, file-count and **1,000-line-per-file**
  caps in `scripts/check-evidence-budget.ts`; and deleting tracked evidence needs the owner's
  checkpoint. Write the record, keep it under the line cap, and it looks after itself.
- **The retention index restales on every doc edit.** `docs/benchmark/SCREENSHOT-RETENTION.md` is
  generated, and `pnpm budgets` fails when it drifts — which means **pre-push fails**. Run
  `npx tsx scripts/generate-retention-index.ts` as the last step before committing, every time.
  This will bite you more often than anything else on this page.
- **`pnpm budgets` needs a built workspace.** `CAPABILITY_BUILT_IMPORT_MISSING` means "no `dist`",
  not a bad capability. Run `pnpm build` first.
- **`pnpm test` aborts in `packages/runtime-native`** before the ~4,000 root tests run, whenever the
  native contract binaries are unbuilt — normal in a fresh worktree. That is fail-closed behaviour,
  not your regression. Run `npx vitest run` directly to get the root number.
- **`git ls-files` does not tell you what a spec reads.** If you untrack or move anything, verify
  with `git archive HEAD | tar -x` into an empty directory and run the suite *there* — a spec can
  depend on a directory it never names. PRD-323 got this wrong twice, each time costing a CI round
  trip, because everything passed locally where the files were still on disk. Run the same check
  against `origin/main` as a control: 8 files fail in any archive-built tree and are the harness,
  not you.
- **Commit messages go in a file.** Backticks in `git commit -m` are command substitution and will
  silently eat every symbol name. Use `-F`.

### Bites you the first time you rebase

**Rebasing across the PRD-323 Phase 4 commit deletes `docs/benchmark/sweeps/` arm sources from your
working tree**, and `.gitignore` then hides their absence from `git status`. Git removes files it
was tracking when moving between commits either side of the untracking. Recover with:

```sh
git restore --source=origin/main --worktree docs/benchmark/sweeps
```

Related: that tree is now **half tracked**. Measurement artifacts (`proof.json`, `sweep.json`,
`proof-artifacts/`, `captures/`) are the benchmark record and stay in git; generated arm sources are
untracked *except* for the 13 archives a `docs/verification/sweep-*.md` ledger names, because
`sweep-delta.spec.ts` and `sweep-ledger.spec.ts` recompute their measurements from that source.
`scripts/__tests__/sweep-source-negations.spec.ts` keeps the two lists in step — if it goes red, it
tells you which archive and what to add.

### One number on this page is dated on purpose

The measured evidence above is from `sandbox/wildwood` at `d535f51`, a **separate repository** at
`../sandbox`, not a subdirectory. Wildwood has moved since. If you re-measure and get different
bytes, the commit is why — that is drift in the subject, not an error in the record.
