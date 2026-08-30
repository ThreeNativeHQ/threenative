# PRD-254 mobile decoder lane audit — 2026-08-30

Baseline: `e75b9335`  
Stale lane: `worktree-agent-a78ac559a62314fcf` at `ec31e840`  
Shipped implementation: `5ebebd95` on main  
Outcome: **ALREADY LANDED AND DETACHED-PROVEN — do not replay the stale commit**

## Repository proof

Main already contains `assertNativeAssetsCompatible`, the mobile decoder Vite plugin, and
`packages/create-threenative/__tests__/native-ktx2.spec.ts`. The stale commit remains patch-unequal
because later work changed the same files, but its capability is present through `5ebebd95`.

```sh
pnpm exec vitest run packages/create-threenative/__tests__/native-ktx2.spec.ts
```

Result: exit 0, 1 file and 8 tests passed. The cases include an asset-free mobile bundle, real
desktop decoders, a planted game-owned WebAssembly control, unsupported KTX2/mesh manifests, and
the unchanged browser KTX2 path.

## Detached packed-tarball proof

Sandbox:
`/home/joao/projects/threenative/sandbox-runs/prd254-mobile-decoder-20260830/prd254-mobile-decoder`

`pnpm sandbox --genre open-world --template minimal` built and installed local tarballs outside
the workspace. The sandbox reported zero readable framework-source lines and one generated
`AGENTS.md` in scope. Strict TypeScript typecheck passed.

The shipped `@threenative/runtime-native/scripts/bundle.mjs` bundled the identical game for Android
and desktop:

| Target | Bytes | `WebAssembly` references | Decoder evidence |
| --- | ---: | ---: | --- |
| Android | 4,497,614 | 0 | KTX2 and mesh-compression refusal markers present |
| Desktop | 6,896,051 | 15 | Basis and Draco decoder code present |

`pnpm test` then built the web target and passed all three generated headed WebGPU scenarios on an
NVIDIA/Turing adapter with zero diagnostics. The inspected play capture was nonblank and visibly
contained the player, platform, lighting, and HUD.

## Mutation red

Only the installed tarball's `mobileDecodersPlugin` registration was removed. Rebundling Android
produced 4,617,760 bytes containing `WebAssembly`; the zero-reference assertion printed

```text
RED: mobile bundle contains WebAssembly after decoder exclusion is removed
```

and exited 1. Restoring the plugin produced a byte-identical copy of the original 4,497,614-byte
Android bundle with zero references.

## Boundary

- No framework source was edited; the feature was already shipped.
- No APK or physical-device claim is made. Published prebuilt runtime/signing assets remain the
  generated project's separate packaging boundary.
- The sandbox mini-game validates web behavior and visual integrity; the feature's decisive
  observation is the native bundle content because decoder exclusion is build-time behavior.
