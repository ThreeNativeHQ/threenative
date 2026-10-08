# PRD-530 — Strict native-TypeScript game packaging (N17)

**Status:** IN PROGRESS — later milestone (gate T), after promotion; not required by N20 (owner decision 2, 2026-10-04)
**Complexity:** 4 — gate T: compiler, engine and packaging meet in one inspected artifact
**Owner:** João
**Work package:** N17 — [native-engine batch](README.md)
**Depends on:** [N05 — native TypeScript](../done/native-engine/N05-native-typescript-qualification/README.md), [PRD-499 (N02)](PRD-499-n02-the-host-links-without-a-js-engine.md), and the engine PRDs the chosen game needs; starts after [PRD-533 (N20)](PRD-533-n20-platform-qualification-performance-default-promotion.md) promotes the V8-runtime product

## Context

Gate T (§1) is a representative TypeScript game, written with the familiar imports, compiled to native
code and running on the native engine with no interpreter or JIT. §13 adds the packaging rules:
separate configuration dimensions for engine implementation, game runtime and UI; contradictory
combinations rejected; artifact identity naming engine, ABI, compatibility and shader-package
revisions, compiler identity, architecture, GPU backend and capabilities; checksum-verified prebuilt
SDK artifacts. §17 requires that a game edit rebuilds the game module and its assets, not Dawn, the
engine or LLVM. Packaging today is `packages/runtime-native/scripts/package-desktop.mjs`,
`package-android.mjs` and `install-prebuilt.mjs`; profile resolution lives in `packages/create-threenative`.

## Solution

1. Three configuration dimensions (proposed names, recorded in N00's ADR): engine `legacy | native`,
   game runtime `js | native-aot | cpp`, UI `webview | native | none`. Strict = `native` +
   `native-aot|cpp` + `native|none`; any contradiction fails at configuration time, and a strict
   artifact refuses to dynamically load a JS runtime component.
2. The packager embeds an identity manifest (§13) and a capability list in the artifact; startup
   rejects a mismatched ABI, compatibility or shader-package version before the game starts (§8.2).
3. The compiler and native SDK come from checksum-pinned prebuilt artifacts; a game-only edit relinks
   the game module only.
4. The strict artifact is inspected with N02's JS-free tool, and the inspection result plus the
   identity manifest form the evidence manifest (§15.2).
5. Rollback: the `legacy` engine profile stays selectable; there is no automatic fallback from a
   strict artifact to it (§1).

## Out of scope

- The compiler qualification itself (N05). Release-wide qualification and promotion (N20).

## Execution Phases

#### Phase 1: Profiles and identity
**Status:** DONE
**Files:** `packages/create-threenative/` (profile resolution), proposed `packages/runtime-native/scripts/package-strict.mjs`
- [x] Every contradictory engine/runtime/UI combination is rejected with a named error. proof: `pnpm exec vitest run packages/create-threenative/__tests__/native-profile.spec.ts` — 2026-10-05: green (4 tests). `resolveNativeProfile` (`packages/create-threenative/src/native-profile.ts`) applies the decision record's section 6 table: native + VM is the native-engine artifact, native + AOT/C++ + native or no UI is strict-native (JS-free), a WebView keeps an AOT game labelled never JS-free, and the contradictions throw `TN_PROFILE_LEGACY_NATIVE_RUNTIME`, `TN_PROFILE_NATIVE_LOADS_JS`, `TN_PROFILE_STRICT_LEGACY`, `TN_PROFILE_STRICT_JS_RUNTIME`, `TN_PROFILE_STRICT_WEBVIEW` or `TN_PROFILE_UNKNOWN`, naming the offending values; none falls back. The spec enumerates all 72 combinations of the dimensions, `loadsJsRuntime` and a strict request. The packager calls it once `package-strict.mjs` exists (phase 1 box 2)
- [x] A strict artifact carries the §13 identity manifest and refuses a mismatched ABI at startup. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_artifact_identity` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm. The manifest (`src/engine/abi/identity.{h,cpp}`, one `key value` per line so startup needs no JSON parser) names the engine revision, engine ABI, compatibility contract, scene, shader package, capability count and digest, compiler, architecture and GPU backend; `tn-native-engine-identity --write` is what a packager runs. `checkIdentity` refuses a missing, repeated or unreadable key (`TN_ARTIFACT_IDENTITY_MALFORMED`), any version field through the ABI handshake (`TN_ARTIFACT_VERSION_MISMATCH: TN_DIAG_*`, each of the five tested) and another architecture. At startup, `tn-native-engine-host --identity` refuses before any engine or game code: `native_engine_host_identity_accept` runs and draws, `native_engine_host_identity_refuse` (engine-abi edited to 999) exits 3 with `TN_DIAG_ENGINE_ABI_MISMATCH`

#### Phase 2: Incremental strict builds
**Status:** DONE (re-proven with Perry 2026-10-06)
**Files:** proposed `packages/runtime-native/scripts/package-strict.mjs`
- [x] A game-source-only edit rebuilds the game module without recompiling Dawn, the engine or the compiler. proof: `pnpm exec vitest run packages/runtime-native/__tests__/strict-incremental-build.spec.ts` — 2026-10-06, re-proven with Perry (decision 11): `buildStrict` (`package-strict.mjs`) stages the game as `run-corpus.mjs` does and links it with one strict `perry compile`; a game-source edit reruns only the game steps (`typescript`, `link`), never the shim, hooks, engine archives or the compiler. `strict-incremental-build.spec.ts` 6 of 6, the real lane included (9.2 s). Red control: keying `hooks` on the game source makes a game edit rerun `hooks`, the spec fails. tslang history: 2026-10-05: green (6 tests), the real lane included. `buildStrict` (`packages/runtime-native/scripts/package-strict.mjs`) takes the pinned tslang and the engine archives as inputs and never builds either: a missing archive is `TN_STRICT_ENGINE_MISSING` with nothing run. Each step (TypeScript objects, shim, hooks, link, identity manifest) records the sha256 of its inputs and is skipped when they match. With recording tools: an unchanged rebuild runs nothing; a game edit runs the compiler per module and one link, no `cc`, hooks or engine build; new engine archives rebuild only the hooks and the link; a failed step records nothing and is retried. With the real tslang and `build/tn-linux`: the corpus fixture builds, an edit reruns only `typescript` and `link`, the artifact prints the expected output, and its identity manifest passes `tn-native-engine-identity --check`. The corpus now builds its "three" cases through the same function (16/16 native). Red control: disabling the step cache fails 5 of 6
- [x] Prebuilt SDK and compiler artifacts are refused on checksum mismatch. proof: `pnpm exec vitest run packages/runtime-native/__tests__/strict-prebuilt-checksum.spec.ts` — 2026-10-05: green (6 tests). For the native SDK prebuilt (`install-prebuilt.mjs`, served over loopback) and the native-TypeScript compiler (`provision.mjs`, a real tar archive): a payload matching its pin installs; one byte changed is refused and leaves nothing at the destination (no runtime or helper and an `ok: false` install status; no archive, `.part` or toolchain, `TN_NATIVE_TS_CHECKSUM`); a pin that is not 64 lowercase hex is refused before any download. That last case found a gap: `provision` downloaded before refusing a malformed pin, so it now checks the pin first. Red controls: removing either guard fails its case

#### Phase 3: Gate T
**Status:** IN PROGRESS — the owner chose Midway Open Pacific (2026-10-08). It is a sandbox game in its
own repository, so its source is never copied here.
**Files:** `packages/runtime-native/scripts/package-strict.mjs`, `packages/runtime-native/src/engine/`
- 2026-10-08 measurement, unchanged game: the V8 bundler refused 50 symbols. Closed on
  `lane/ne-530`, each red-green against three: LatheGeometry, CatmullRomCurve3, TubeGeometry, the side
  and usage constants, authored keyframe tracks and AnimationClip, No/Normal/AdditiveBlending in the
  renderer, Path/Shape/ShapeGeometry/ExtrudeGeometry (earcut 3.0.2), half-float DataTextures and
  DataUtils. Two gaps the bundler cannot see are also closed: `geometry.attributes` and `geometry.groups`
  in V8. 36 remain: 27 TSL nodes (13 of them post-chain), mergeGeometries, PCFShadowMap (the V8
  renderer facade has no `shadowMap`), CanvasTexture, ImageBitmapLoader, HDRLoader, MeshBVH and three
  audio classes. `package-strict.mjs` cannot build any game that imports `@threenative/core`: it stages
  only the entry and its flattened sibling modules, and Perry refuses core's `three/webgpu`, `three/tsl`,
  loader, `three-mesh-bvh` and `zustand` imports and its `document`/`window` reads.
- [ ] The representative TS game's strict Linux artifact passes JS-free inspection: no VM, no WebView, no embedded script. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs --binary <strict linux artifact>`
- [ ] That inspected artifact runs its playtest journey end to end on desktop. proof: `node packages/playtest/dist/runner/cli.js <game>.playtest.json --target desktop`
- [ ] The same game's strict Android artifact passes its journey on the emulator. proof: `node packages/playtest/dist/runner/cli.js <game>.playtest.json --target android`

#### Phase 4: Strict packaging of real games
**Status:** IN PROGRESS — measured 2026-10-08 on Perry 0.5.1520 over the 13 templates and Midway: Perry
compiled every module (29 to 56 per game, none rejected as syntax) and no game links, because
`@threenative/*`, `three/tsl`, `three/webgpu`, `three/addons/*` and many three-facade members are
missing. The part of Midway's simulation that does link (`src/sim`, 12.7k lines) runs under Perry and
prints what tsx prints in 28 of 32 valid check scripts, 13 to 16 times slower.
**Files:** `packages/runtime-native/scripts/package-strict.mjs`, `tools/native-typescript/compile-game.mjs`
- [x] A survey compiles a game's whole source tree under strict Perry, names missing engine API apart from Perry's own errors, and runs the game's check scripts under tsx and Perry. proof: `pnpm exec vitest run tools/native-typescript/__tests__/compile-game.spec.ts packages/runtime-native/__tests__/strict-incremental-build.spec.ts` — 2026-10-08: 25 tests green. On minimal: 30 modules compiled, 0 Perry errors, 15 unresolved imports, 40 undefined symbols, 28 missing facade members.
- [ ] The strict build stages `@threenative/core` and its workspace dependencies, so a game's `@threenative/*` imports resolve. proof: `node tools/native-typescript/compile-game.mjs packages/create-threenative/templates/minimal` reports no unresolved `@threenative/*` import (today: `@threenative/core`, `@threenative/core/playtest`, `@threenative/physics`).
- [ ] Midway's simulation check scripts print the same stdout and exit code under Perry as under tsx, as a regression check for each Perry upgrade. proof: `node tools/native-typescript/compile-game.mjs <midway-open-pacific> --checks <midway-open-pacific>/scripts --package @threenative/core=packages/core/src/flight.ts` (2026-10-08: 28 of 32 valid scripts `same`; `ai-flight-cost` fails its own 4 ms ceiling under Perry; `check-fluid`, `check-particle-render` and `check-hud-transport` need engine API that is not there yet).

## Blocked on

- Choosing the representative game for gate T: owner decision (João).
- The strict Android artifact on physical hardware: the owner's attached device.
- Which native form each web-only import of `@threenative/core` takes under strict mode, one owner decision each: `three/webgpu` and `three/tsl` (the TSL names `Fn`, `uniform`, `float`, `vec2`..`vec4`, `bloom`, `ao`, `denoise` and the rest), `three/addons/*`, the GLTF, KTX2, DRACO and meshopt loaders, `three-mesh-bvh` (its namespace import is a hard Perry error), `zustand/vanilla`, and the `document`, `window` and `ResizeObserver` reads. Perry reports each as an unresolved import and the link then fails on the symbols.
- Five Perry 0.5.1520 performance cliffs on object-property patterns that game state uses (reading a missing property, the `in` operator on a missing key, reading a frozen object, `Object.freeze`, object spread; 80 to 300 times slower than V8, output identical): upstream Perry; filing is the owner's call. Reproducers: `tools/native-typescript/repros/`.

## Decisions

- 2026-10-08, owner via lead: no workaround for the Perry cliffs in game code, and no strict-build lint for `Object.freeze` or spread, because either would teach games around a compiler bug.
- 2026-10-08, lead: the strict-packaging work for real games extends this PRD as Phase 4 instead of opening a new PRD (numbers were colliding across worktrees). That is a fourth phase against R5's three; split it into its own PRD if it grows past these three boxes.
