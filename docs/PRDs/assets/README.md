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
| **349 — the cook is on by default** | 289 MB → ~35-45 MB on web/desktop | — |
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

- **`needSupercompression` gains 0.0%.** Zstd needs RDO first. A PRD-349 phase was cut on this.
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
