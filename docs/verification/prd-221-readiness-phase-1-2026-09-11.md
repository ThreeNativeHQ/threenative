# PRD-221 phase 1 — default V8 is provisioned with aligned libraries for both Android ABIs

Status: **COMPLETE — pending independent reviewer PASS.** Supersedes
`prd-221-readiness-phase-1-2026-09-10.md`, which read INCOMPLETE and predated the merge of the
implementation to `main` (PR #167, `48276b273`).

Candidate: branch `prd221/android-v8-16kb`, HEAD `99eac80ec7e969ec4aa9c90507d0d4df9ef63139`
(the merge of `origin/develop` into the branch). Host: linux-x64, Node v20.19.6, Vitest 4.1.10.
Every command below was executed on this machine, 2026-09-11.

## Wiring on the branch

The phase's implementation is already on `main`; a fresh read of the landed callers on this
candidate:

- `packages/runtime-native/scripts/download-deps.mjs:31` imports `assertAndroid16KbAlignment` and
  calls it at `:1019` on every built `.so`.
- `packages/runtime-native/scripts/build-android-v8.mjs:147` asserts it on the provisioned V8.
- `packages/runtime-native/android/app/build.gradle.kts` records the SDL3 3.2.30 pin.
- Recipe 6 (this branch, commit `4e316be53`) adds the `kMinimumOSPageSize` 16 KB clause for
  Android: V8 11 leaves Android in the 4 KB `else` branch, and `v8::base::OS::SetDataReadOnly`
  then `mprotect`s a 4 KB-aligned region on a 16 KB device — EINVAL, `V8_Fatal`. The clause is
  asserted by `tests/android-16kb-alignment.test.mjs`.

## Required test — green

```sh
packages/runtime-native $ ../../node_modules/.bin/vitest run --config vitest.config.ts \
  tests/android-16kb-alignment.test.mjs
```

```
Test Files  1 passed (1)
Tests       35 passed (35)
```

## Observed red, then green — against real provisioned binaries, not fixtures

The control the phase names is "feed the historical misaligned binary to the same
provisioned-artifact check." The primary checkout on this machine still carries exactly that
binary: `packages/runtime-native/third_party/v8-android` in the main checkout is the pre-recipe-6
4 KB payload. Both halves were run through the branch's own `assertAndroid16KbAlignment`:

```
RED   /…/threenative-engine/packages/runtime-native/third_party/v8-android/lib/arm64-v8a/libv8android.so
      sha256 eddea92d4cea2ac34e373629327c6293981444fdaf93f8b16986a17effd33124
      ANDROID_16KB_MISALIGNED — LOAD alignments 0x1000 (2**12), 0x1000 (2**12), 0x1000 (2**12)

GREEN …/worktrees/prd221-16kb/packages/runtime-native/third_party/v8-android/lib/arm64-v8a/libv8android.so
      sha256 aa3b488c35ddb346097c3b058526cd7e8d6ba5321e2ea46afc7349fa9af3f221
      LOAD alignments 0x4000 (2**14), 0x4000 (2**14), 0x4000 (2**14)
```

The historical x86_64 binary (`e691332f558e528a49319e32c51df170be17824e623388a417900a60601701d8`)
is rejected the same way. Both `eddea92d…` and `e691332f…` are the same hashes recorded in the
2026-09-10 historical control, so this is the real prior payload rather than a synthetic ELF.

The replacement payload's arm64 and x86_64 `libv8android.so` (`53c620378f6872c4d4763095f77f8cb83aa7182ab8f8ea92e55448187a3ac397`),
`libc++_shared.so`, and the per-ABI `snapshot_blob.bin`
(`8fc946b2d1c7147d…`, `90b174978868b078…`) are all present and 16 KB clean; the recipe-6 build
receipt at `packages/runtime-native/third_party/v8-android/build-receipt.json` records
`"recipe": 6`, `"loadAlignment": 16384`, V8 `11.0.226.16`, pinned source
`7999223ca1644726339aae43d9435c721c8a4bb0` and NDK `28.2.13676358`.

## User verification — default-V8 host boots a real game on 16 KB

The default starter was rebuilt from the branch's own packager against this recipe-6 V8 and run
on the local `threenative_ps16k` AVD (`getconf PAGE_SIZE` **16384**,
`google/sdk_gphone16k_x86_64/emu64xa16k:16/BE2A.250530.026.F3/13894323:userdebug/dev-keys`,
x86_64, API 36). The log names V8 and its ABI rather than choosing QuickJS:

```
[V8] Creating engine...
[V8] Initializing V8 JavaScript engine...
[V8] Using external startup snapshot (45421 bytes)
[V8] V8 initialized successfully
[V8] Version: 11.0.226.16
TN_COLD_START:{"segment":"first_playable",...}
TN_SURFACE_FRAME:{"view":true,"present":64}
```

A screenshot at that point is 2400×1080 with 1504 distinct colours — a rendered frame, not a
blank one. Full run detail is in the phase-3 record of the same date.

## Gates

```
packages/runtime-native  tests/android-16kb-alignment.test.mjs                        35 passed
packages/runtime-native  android-16kb-alignment + android-packaging (phase 2)         48 passed
```

`pnpm typecheck`, `pnpm lint`, `pnpm budgets` are run for this candidate before the push that
carries this record; their results are recorded in the PR conversation.

## Remaining

Independent reviewer decision: **PENDING**, not self-awarded.
