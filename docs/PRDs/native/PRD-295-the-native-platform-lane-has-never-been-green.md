# PRD-295 — the native platform lane has never been green

**Status: PROPOSED, filed 2026-08-31 at `233165fa`.** Filed at the moment the lane became visible,
and made advisory in the same commit so it reports instead of blocking. That is a narrowing of what
CI claims and it is written down here rather than assumed.

## How a lane runs for the first time after months

`native-platforms` in `.github/workflows/ci.yml` runs only on `main` and declares `needs: test`.
`test` was red on every run before 2026-08-31, so the lane was **skipped every single time**. The
first two executions in its life both failed, on all five legs:

```text
failure  native-platforms / macOS desktop core
failure  native-platforms / Windows desktop core
failure  native-platforms / Android emulator visual parity
failure  native-platforms / iOS simulator runtime and no-Xcode consumer handoff
failure  native-platforms / Scaffolded starter desktop artifact
```

Nothing broke it. Fixing the jobs in front of it revealed it — which is worth remembering as a
property of `needs:` chains generally: a gate behind a permanently red gate is not a gate.

## What is actually failing

Its first failure was a build error, now fixed: `threenative-lifecycle-policy-test` included
`<SDL3/SDL.h>` while `mystral-runtime` links SDL3 `PRIVATE`, so the include directories never
propagated and the target only compiled where SDL3 already sat on the default search path. The
hosted macOS and Windows runners are not that. Fixed by linking the SDL3 target itself.

**`native:build` succeeds.** What fails is `native:verify:desktop`, and specifically three native
contract targets on macOS:

| Target | Symptom |
| --- | --- |
| `threenative-bindings-creation-test` | reports `proof: creation-refusal` instead of `native WebGPU creation bindings passed` |
| `threenative-shutdown-lifetime-test` | `invocation ["timer-watch", …]` exits 1 |
| `threenative-video-recorder-state-test` | `invocation []` exits 1 |

The runtime initialises correctly first — the log shows `Adapter acquired successfully`,
`Headless adapter: Apple Paravirtual device`, `Backend: Metal`, and
`rg11b10ufloat-renderable: yes`. One probe reads `timestamp-query: no`, which is the runner's
paravirtualised GPU and a plausible thread to pull first: a creation path that refuses when an
optional feature is absent would produce exactly `creation-refusal` on this device and pass on a
real one.

## Why it is advisory rather than fixed

What this lane covers — macOS, Windows, Android and iOS contract tests — is not what 0.3.0 claims.
[`ROADMAP.md`](../../strategy/ROADMAP.md) licenses browser, Linux desktop and the Android emulator
with qualifications, and claims nothing for iOS hardware. A lane that has never been green, over
platforms the release does not claim, cannot be the thing that blocks the release.

The distinction that matters: **`native:build` succeeding is what the release needs.** The release
workflow builds the prebuilt artifacts; it does not run `native:verify:desktop`. So these failures
do not mean the artifacts are unbuildable — they mean three contract tests do not pass on a
paravirtualised Mac.

## What Done looks like

1. Each of the three targets either passes on the hosted runners or declares, in the registry, that
   it needs a capability those runners lack — the same fail-closed shape
   `conformance/registry.json` already uses, where an unselected row is reported **blocked**, never
   passed and never omitted.
2. `continue-on-error: true` comes off `native-platforms` in `ci.yml` in the same commit. An
   advisory lane that stays advisory becomes noise nobody reads.
3. The Windows, Android-emulator and iOS-simulator legs get the same treatment; only the macOS leg
   is diagnosed above, because it is the one whose log was read.

## What not to do

Do not delete the lane, and do not narrow it to the platforms that pass. Its value is precisely
that it fails honestly on platforms this project intends to support and has not yet proven — the
roadmap's Tier 2 exists for the same reason.
