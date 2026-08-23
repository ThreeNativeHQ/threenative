# PRD-095 execution evidence — KTX2/Basis texture compression, 2026-08-22

Lane: `lane/asset-pipeline`. Depends on PRD-094 (done, archived).

## What executed

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 (after fixing two test stubs typed against the wrong `onLoad` contravariance) |
| `pnpm lint` | exit 0 |
| `pnpm test` full suite | **exit 0, twice consecutively** after the fixes below; 1,63x tests |
| starter `textures.playtest.json` | PASS on a real GPU adapter (`turing`, `--headed` under `sh scripts/xvfb.sh`; the first headless attempt silently served SwiftShader — the known trap, confirmed live) |

## The proof

- Baseline run with `assets.textures: "none"` vs compressed run: cross-run screenshot compare
  changedPixelRatio **0.0155**, mean channel-sum diff **0.848** — visually identical.
- Byte report honestly records that the shipped proof texture is a 16×16, 150-byte PNG and
  **grew** to 542 bytes as `.ktx2` (container overhead dominates at toy scale). VRAM still
  drops ~1 KB RGBA → ~170 B BC1. The wire-size win this PRD delivers arrives at real texture
  sizes; the budgets script now surfaces aggregate template texture bytes and triggers when
  totals regress.

## Implementation shape

- Encoder: `ktx2-encoder@0.6.0` (MIT) — in-process WASM basis_universal; pure-JS
  `pngjs`/`jpeg-js` decoders; all confined to Node-only `@threenative/assets`.
- Codec choice: config override > `*_normal.*`/`*_nrm.*` filename > decoded alpha presence;
  normal maps get non-sRGB + isNormalMap flags. Full mip chains required at encode time,
  fail-closed (`TN_ASSETS_MIP_CHAIN_INCOMPLETE`).
- Transcoder copied into `public/basis/` via project `createRequire.resolve` so a three-side
  move fails at build time, never as a runtime 404.
- Runtime: one memoised `KTX2Loader` per loader with `detectSupport(renderer)` called exactly
  once; unsupported platforms throw naming renderer kind + UA (`TN_ASSETS_KTX2_UNSUPPORTED`);
  no-renderer and unprobeable-renderer cases throw rather than silently RGBA-falling back.
  `GLTFLoader.setKTX2Loader` shares the same instance for model-embedded compressed textures.
- `PIPELINE_VERSION` bumped 1 → 2 (hash invalidation).

## Negative controls observed red (then restored)

mip generation disabled; alpha stripped from a UASTC fixture; override removed; memoisation
dropped (detectSupport ×3); unsupported stub reporting S3TC only; `setKTX2Loader` wiring
disabled; `.ktx2` branch disabled → falls to TextureLoader → cannot load.

## Defects found by the full gates after phase-level green

1. Bundled CJS deps crashed the packed CLI (`Dynamic require of "util"`) — fixed with a
   createRequire banner in tsup config.
2. `maxMaterials` in core's config type tripped the visual-concerns grep — config.ts joined
   the exemption list on stated terms (it declares budget names, originates nothing).
3. Uncapped vitest workers on a 24-core machine starved browser-driven input specs into
   nondeterministic reds — `maxWorkers: 8` in the root config; two consecutive green runs.

## Known gaps routed onward

- playtest harness gap (pre-existing): scenario `baselineImage` is schema-validated but never
  loaded by the comparator; the cross-run fidelity number above was produced outside the
  harness. Owning area: packages/playtest.
- Non-texture manifest entries list `passes: ["ktx2"]` cosmetically (registry-wide pass that
  no-ops on other kinds).
- Framework LOC now **15,770/15,000** (+770 across asset-pipeline lanes) — review owed in the
  series close-out.

## What this record does not claim

No native decode claim of any kind: `.ktx2` on native is PRD-097's whole subject. No Android,
iOS, or device claim. No normal-map-on-device visual gate beyond the fixture-level codec tests.
