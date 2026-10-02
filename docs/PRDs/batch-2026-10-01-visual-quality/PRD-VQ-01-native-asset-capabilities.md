---
prd_contract: v1
---

# PRD-VQ-01 — Native asset compatibility follows the selected runtime and actual decoders

**Status:** PARTIAL — 2026-10-02. Bounded desktop/unknown-runtime fail-closed repair implemented; mobile selected-artifact resolution and packaged-loader qualification remain open.
**Batch:** [Visual quality execution batch](https://github.com/ThreeNativeHQ/threenative/blob/d9ac5b4e97f6b1383bd163d91619cffa7c6c0ef5/docs/PRDs/batch-2026-10-01-visual-quality/README.md). **Wave:** 0 / correctness.
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

The unit proof paths now exist; the Phase 3 scenario paths remain **planned implementation targets**, not passing runtime proof. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow [EXECUTE.md](https://github.com/ThreeNativeHQ/threenative/blob/d9ac5b4e97f6b1383bd163d91619cffa7c6c0ef5/docs/PRDs/batch-2026-10-01-visual-quality/EXECUTE.md) for fixture setup, variables, review and repository gates.

### Phase 1 — One capability decision

- [ ] Implement capability resolution from the selected artifact, including unknown-artifact handling and the full target/engine table. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.
  Partial: desktop resolves the packager's actual binary before cooking and hashes its bytes. Failed, absent, unknown and non-V8 probes take the decoder-free path. Android/iOS never probe the desktop packaging executable; their exact artifact/cohort resolution remains open.
- [ ] Wire the same capability record into cooking and compatibility validation; preserve decoder-free rollback. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.

  Partial: the record governs cooking, compatibility guards, and the desktop native-backend bundle path; embedded/shared KTX2 and Meshopt/Draco declarations are refused when unavailable. The existing desktop V8 path is preserved, not newly qualified.

### Phase 2 — The packaged bytes are authoritative

- [ ] Make bundling and loading retain exactly the declared decoders and invalidate stale cook-cache entries. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-native-asset-capabilities.spec.ts`.
  Partial: cook keys include explicit decoder capabilities and selected desktop runtime SHA-256; QuickJS/unknown desktop bundles use the existing refusing stubs. Decoder versions, KTX2 block-format validation and manifest-versus-payload verification remain open.
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

This executor has no GPU device, Android SDK/adb or KVM. Xvfb is denied with EPERM; browser/native pixels and emulator correctness are unrun. These limitations do not qualify any codec. The owner explicitly requires screenshot proofs for every PR (2026-10-02); no actual relevant runtime screenshot has been captured, so this PR remains draft. Test logs and synthetic images are not screenshot proof.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.

### Bounded implementation verification — 2026-10-02

- Mandatory capability MCP search/detail reused `compileAssets`, `resolveBasisTranscoder` and the existing portable loader; no new codec or renderer was added.
- Red/green: 9 failures first demonstrated fail-open unknown engines and desktop codec bypass; 3 more demonstrated stale cache identity and QuickJS decoder inclusion. The final focused rerun passed 40/40 across capability/cache, native-KTX2 and report suites. A separate report regression failed on the false `no WebAssembly` claim and passed after diagnostics named missing qualified decoders (12/12 report tests).
- `pnpm exec vitest run packages/create-threenative/__tests__/build.spec.ts`: 29/29 passed in the combined nearest-lane run. `native-consumer.spec.ts` live caller checks pass 3/3, including exact resolved binary forwarding and preservation of the previous packaged artifact after an authored KTX2 refusal. The template-native and consumer CLI suites pass 16/16 after their packager fixtures follow the new early resolver contract.
- `pnpm --filter @threenative/assets build` and `pnpm --filter create-threenative build`: passed including declaration output and publint. Scoped create-threenative and assets TypeScript checks passed. Root lint passed with warnings; agent mirrors regenerated.
- Aggregate qualification is **not green**: root `pnpm test` stops before tests at tsx IPC `listen EPERM`; root `pnpm typecheck` was killed with exit 137. The broader native consumer lane has two unavailable-`jar` failures, separately reproduced using its unchanged baseline test source. Full build, GPU/native scenarios, decoder memory/lifecycle measurements and actual packaged-loader codec pixels remain unverified.
- All phase and acceptance boxes intentionally remain open. No full Phase 1, Phase 2, native decoder admission, visual result or PRD completion is claimed by this patch.
