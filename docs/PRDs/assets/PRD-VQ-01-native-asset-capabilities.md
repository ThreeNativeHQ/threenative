---
prd_contract: v1
---

# PRD-VQ-01 — Native asset compatibility follows the selected runtime and actual decoders

**Status:** PROPOSED — 2026-10-01. No implementation or qualification is claimed.
**Batch:** [Visual quality execution batch](README.md). **Wave:** 0 / correctness.
**Dependencies:** None. This is a build/runtime contract repair, not permission to remove compatibility guards.

## Grounding and intended outcome

[packages/create-threenative/src/build.ts](https://github.com/ThreeNativeHQ/threenative/blob/d72778382b134ef8763f58825cb4d4fd8cc0f6e3/packages/create-threenative/src/build.ts) still rejects compressed assets by mobile target in `assertNativeAssetsCompatible`, while the runtime documentation identifies Android V8 as the default. The source establishes inconsistent capability selection; it does not prove that shipping V8 alone makes the Basis, Meshopt or Draco loading paths work. Workers, bundling, file access, decoder payloads and GPU formats are separate requirements.

**Outcome:** A packaged game either decodes its declared assets on its selected runtime or is refused before publication with an accurate codec-specific reason. Android V8 and QuickJS must not be conflated; desktop QuickJS must not bypass checks simply because it is desktop.

## Design and ownership

Resolve one runtime capability record from the exact selected artifact/cohort before cooking. Thread it through asset cooking, the compatibility guard, native bundling and the runtime loader. Record engine, WASM support, packaged decoder versions and supported texture formats independently. An unknown capability takes an explicit decoder-free path or fails; it is never inferred from the build machine or from a desktop executable used to package Android. Keep QuickJS rollback supported. Do not silently change an authored asset or trust a manifest that disagrees with the packaged bytes.

Reuse `runtimeHasWebAssembly`, `assertNativeAssetsCompatible`, asset compiler decoder options and `packages/runtime-native/scripts/bundle.mjs`. Extend the artifact capability contract only where necessary. No new renderer, codec implementation, or blanket Android whitelist. Preserve current WebGL and decoder-free fallbacks.

## Required behavior

- A table-driven suite covers web, desktop V8, desktop QuickJS, Android V8, Android QuickJS and unknown artifacts, with each codec independently allowed or refused.
- The loader validates actual KTX2 block formats and fallback transcodes. Mesh compression is separately tested; smaller download bytes are not reported as smaller GPU vertex buffers.
- Cook-cache keys include decoder capabilities and cohort identity. Switching engine or codec cannot reuse incompatible output.
- Diagnostics identify the asset, codec, selected artifact and missing capability. Build failure must leave the previous packaged artifact intact.

## Execution phases

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow EXECUTE.md for fixture setup, variables, review and repository gates.

### Phase 1 — One capability decision

- [ ] Implement capability resolution from the selected artifact, including unknown-artifact handling and the full target/engine table. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.
- [ ] Wire the same capability record into cooking and compatibility validation; preserve decoder-free rollback. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.

### Phase 2 — The packaged bytes are authoritative

- [ ] Make bundling and loading retain exactly the declared decoders and invalidate stale cook-cache entries. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.
- [ ] Create separate tiny textured/animated fixtures for KTX2, Meshopt and Draco; assert decoded texture content and geometry rather than only a successful import. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.

### Phase 3 — Qualify the visible result

- [ ] The unchanged web fixture renders each codec correctly, with named adapter and no loader/GPU diagnostics. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-native-asset-capabilities.playtest.json --url ${VQ_URL:?} --browser-recipe webgpu`.
- [ ] The packaged Android V8 fixture decodes the admitted codecs on an emulator; unsupported codecs remain explicitly refused and the QuickJS decoder-free fixture still runs. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-native-asset-capabilities.playtest.json --target android --device ${VQ_ANDROID_DEVICE:?}`.

## Acceptance criteria

- [ ] All admitted codecs are demonstrated through the packaged loader, not merely through WASM availability; all refused combinations retain actionable build errors. proof: the completed Phase 3 scenario outputs, with the named fixture, package/cohort and adapter recorded inline here.
- [ ] The feature preserves its documented inactive/fallback path and releases owned resources after repeated lifecycle transitions. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts` plus the Phase 3 lifecycle scenario.

## Performance and promotion

Record encoded bytes, decoded texture/geometry bytes and peak load memory per codec. Enabling a path requires correct pixels and bounded lifetime, not a promised compression ratio. Numerical targets are proposed acceptance targets, not benchmark results. Pin the fixture, metrics and thresholds before changing the implementation; never relax a failing threshold just to mark this PRD complete. Shared abstractions must pass the repository's reuse/LOC admission rule. Appearance remains editable source.

## Blocked on

Physical Android performance and thermals require a named phone and are separate from emulator correctness. Missing codec qualifications must remain individual exclusions.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.
