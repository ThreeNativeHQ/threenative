# PRD-048 — shipping a native game: the CLI and distribution lane

**Status: DONE 2026-08-09, with the release-infrastructure criteria explicitly waived by the
product owner.** Phases 0–3 and 5 are complete. The fail-closed installer and packed-consumer
lifecycle are locally proven, the first tag-gated release run passed all three desktop
builders, and Android Phase 4 has a locally proven packed no-toolchain APK handoff plus a
prepared released-consumer emulator lane. The Android release failure — the clean runner
downloaded the SDL AAR but not SDL's Java glue — has a locally proven `0.1.9` fix.

**Waived, not met:** the release rerun, real assets, checksum lock, registry packages,
clean-machine build, iOS execution and physical-device handoff. Each needs infrastructure or
hardware the owner does not have here; on 2026-08-09 the owner stated these will be validated
separately. They are recorded as open facts, not as passes. §4a keeps them in execution order
for whoever picks them up. Split out of PRD-047 §4 Phase 6
on 2026-08-08, because that phase turned out to contain more unbuilt surface than the five
phases before it combined. Phase 0 evidence is in `docs/verification/PRD-048.md`.

**What this owns:** everything between "the runtime can run our bundle" and "a user who has
never installed CMake ships a game." PRD-047 proved the first. Nobody has attempted the
second.

**What this does not own:** the runtime itself, the render path, the device playtest
transport, native physics. Those are PRD-047, PRD-045 and PRD-046. **This PRD adds no C++.**

**Depends on:** PRD-047 Phase 2 (the import-free ESM bundle is the artifact being shipped)
and Phase 5 (a desktop lane that has actually run on Windows and macOS runners — today
neither has).
**Blocks:** nothing, but nothing in `CHARTER.md` §3's win criteria is reachable without it.
A framework whose native target requires an NDK has not shipped a native target.
**Charter authority:** `CHARTER.md` §6a (four CLI commands, ever — see §3 below, which is a
real tension and not a formality), §10 (budgets).
**Area:** `OPPORTUNITY-AREAS.md` #7.

**Complexity: 7 → HIGH mode.** (new user-facing binary +2, cross-platform binary
distribution +2, install-time network fetch with fail-closed verification +2, template
surface change +1.) No new package, no new language.

---

## 1. Verified starting point — 2026-08-08

Measured, not assumed. Every row is the reason a phase below exists.

| Claim you might assume is true | Actual state |
|---|---|
| A `threenative` CLI exists | **No.** Two binaries ship: `create-threenative` and `threenative-playtest` |
| Templates build through the framework | **No.** All three templates run `vite` / `vite build` directly |
| `CHARTER.md` §6a's four commands are implemented | **No.** `dev`, `build`, `test`, `ship` are an intention; none exists |
| `@threenative/runtime-native` installs a usable binary | **No.** It publishes `src`, `include`, `cmake`, `CMakeLists.txt`, `CMakePresets.json` — C++ source, no `postinstall`, no prebuilt fetch |
| A template can target native | **No.** No template depends on `@threenative/runtime-native`; none has a native build script |
| A desktop packager exists | **No.** PRD-047 Phase 6 named `scripts/package-{macos,windows,linux}.mjs`; those files were never written |
| A bundler exists | **Yes** — `packages/runtime-native/scripts/bundle.mjs`, 220 lines, live, called by the Android proof and `build.gradle.kts` |

**The one green row is the foundation.** `bundle.mjs` already produces the import-free ESM
file that every native target consumes. This PRD is the delivery path around it.

---

## 2. The consumer story, stated once so the phases can be checked against it

```sh
pnpm create threenative my-game     # scaffolds; no C++ toolchain touched
cd my-game
pnpm dev                            # Vite, browser, unchanged
pnpm test                           # playtest, unchanged
pnpm build --target desktop         # or android | ios — new
```

Two properties make or break it, and both are gates below:

1. **No user installs a C++ toolchain, an NDK, Xcode or Rust.** Prebuilt binaries, fetched
   at install time, or this does not ship.
2. **`--target web` behaves exactly as `vite build` does today.** The web lane is the one
   with real users; a distribution PRD that regresses it has failed regardless of what it
   adds.

---

## 3. The charter tension, resolved openly rather than quietly

`CHARTER.md` §6a: *"Four CLI commands, ever: `dev`, `build`, `test`, `ship`."*

Zero of the four exist. So this PRD is not adding a fifth command — it is **implementing
the first of the four**, and the cap constrains it rather than blocking it.

`docs/strategy/CONFLICTS.md:13` already applies the cap correctly to a `doctor` proposal:
a fifth top-level command is a breach, a mode of an existing one is not. The same test
governs here. **`--target` is a flag on `build`, never a command.** If the design pressure
ever pushes toward `threenative package` or `threenative release`, that is the signal the
design is wrong, not that the cap should move.

**Deliberately out of scope:** `dev`, `test` and `ship`. `dev` is `vite` and works; `test`
is `threenative-playtest` and works; `ship` has no defined meaning yet. Implementing one
command well beats stubbing four.

---

## 4. Phases

### Phase 0 — delete the inherited demo distribution machinery

**Complete 2026-08-08.** The six files were deleted, both native proofs still pass, and the
full repository gate is green. Exact commands and measurements are recorded in
`docs/verification/PRD-048.md`.

PRD-047 Phase 1 imported Mystral's own release tooling along with its runtime. It packages
*Mystral's demos*, not ThreeNative games, and **nothing in this workspace calls any of it**:

| Script | Lines | Why it goes |
|---|---:|---|
| `scripts/package-app.sh` | 418 | macOS `.app` from a "MystralNative binary"; sole caller is `build-production.sh`, also dead |
| `scripts/build-production.sh` | 276 | Builds the Sponza and DamagedHelmet demos; mirrors a `sponza.yml` workflow this repo does not have |
| `scripts/prebundle.ts` | 151 | `#!/usr/bin/env bun`; this workspace is pnpm (PRD-047 §2.2 excluded `bun.lock` for the same reason) |
| `scripts/test-examples.sh` | 123 | Screenshots Mystral examples that PRD-047 §2.2 deliberately did not import |
| `scripts/bundle-examples.ts` | 113 | `#!/usr/bin/env bun`; bundles `mystral-test/`, which does not exist here |
| `scripts/set-version.mjs` | 78 | Stamps a *MystralNative* version into `package.json`, `CMakeLists.txt` and `runtime.h`; version authority is now this workspace |

**`scripts/bundle.mjs` (220 lines) is not on this list and must not be deleted** — it is the
live bundler behind PRD-047 Phase 2's import-free ESM file. Deleting it breaks the Android
proof and `build.gradle.kts`.

**Why this is a gate and not tidying.** The six files contain 1,159 dead lines. Native LOC
is measured against a 50,000-line review trigger, with native physics landing in the same
tree. Removing inherited code that has no caller is the kill switch applied to the import.

**Gate:** the six files are gone and `pnpm budgets` reports their 1,159-line deletion plus
the current native LOC measurement; `pnpm typecheck && pnpm lint && pnpm test` stay green;
`native:build` and `build-android-first-proof.mjs` both still run. **A replacement packager
is written fresh
against ThreeNative's targets, never by reviving one of these.**

### Phase 1 — the `threenative` binary, `--target web` only — **COMPLETE 2026-08-08**

A new bin on an existing package — **no new workspace package** (`AGENTS.md` rule 5:
a CLI carries no dependency the others must not inherit). `threenative build --target web`
delegates to Vite and produces a byte-identical result to today's `vite build`.

**Gate:** for all three templates, `threenative build --target web` and `vite build` produce
identical output trees, and every existing template playtest passes against the CLI-built
output with no scenario edited. Zero behaviour change is the phase.

All three packed scaffolds are byte-identical and all 25 committed template scenarios pass
through the repeatable `pnpm test:templates` gate.

### Phase 2 — `--target desktop`, from source, on this machine — **COMPLETE 2026-08-08 (Linux
host only; macOS and Windows OPEN)**

Bundle via `bundle.mjs`, then package a runnable desktop artifact around the built runtime.
Written fresh; Phase 0 deleted the Mystral-branded predecessor.

**Gate:** on this Linux host, `threenative build --target desktop` on a scaffolded project
produces a binary that launches, renders, and satisfies PRD-047's desktop evidence bar —
ready and first-frame markers, 300 frames, clean logs, a dated nonblank screenshot.
**macOS and Windows are explicitly OPEN here** and stay open until PRD-047 Phase 5 runs
those lanes on real runners. A cross-platform claim before that is the dishonesty
`AGENTS.md` names.

### Phase 3 — prebuilt binaries, so no consumer compiles anything — **LOCAL CONTRACT
COMPLETE; RELEASE OPEN**

The release lane publishes a prebuilt runtime per platform/arch. `@threenative/runtime-native`
gains an install step that fetches the one matching the host, verified against a checksum
lock manifest. **Fail closed on an unknown platform** — an unrecognized host errors with the
platform named, and never silently degrades to a source build or a no-op.

`package.json`'s `files` list narrows accordingly: shipping C++ source to consumers is the
current bug, not the design.

**No lock is accepted until matching release assets actually exist.** A manifest pointing at
URLs that 404 is worse than no manifest, because it passes review.

The prepared `native-release.yml` lane builds and executes the desktop hosts, builds both
Android ABIs with exported native-physics symbols, and produces the iOS simulator archive.
It publishes only verified outputs with one checksum lock, then runs fresh packed desktop,
Android, and iOS consumers. The installer bootstraps that release lock from its package
version. Run `31314171195` supplied real desktop build evidence but did not reach publication:
the Android source build lacked `SDLActivity.java`. Version `0.1.9` now includes `sdl3` in the
clean Android dependency transaction; an isolated download and uncached Java compilation
pass locally. This remains **prepared, not release evidence** until the corrected tag runs.

Registry publication is a separate external gate. `create-threenative`, runtime-native,
core, physics, and playtest are absent from npm. The local JavaScript package manifests are
now pack- and publish-ready: scoped packages explicitly request public access, the four
formerly-private packages are public, and UI reserves `0.1.12` because the registry's
`0.1.0`–`0.1.11` releases are an incompatible predecessor. The templates still need their UI
pin coordinated to `0.1.12`; their concurrent PRD-049 `threenative-sculpt-mcp@0.1.0` pin is
also absent from npm. Release order is runtime assets + lock, the complete template
dependency set, runtime-native, then `create-threenative`. A local-tarball consumer proves
the contract but does not satisfy the literal `pnpm create threenative` criterion.

**Gate:** on a clean machine with **no CMake, no NDK, no Xcode and no Rust**,
`pnpm create threenative` followed by `pnpm build --target desktop` produces a running
binary. Separately, a deliberately corrupted checksum **fails the install**, and an
unsupported `platform-arch` fails with that string in the message. Both failures are shown,
not asserted.

### Phase 4 — `--target android` and `--target ios` — **ANDROID PACKED ASSEMBLY LOCALLY
COMPLETE; RELEASED DEVICE CONSUMER AND iOS EXECUTION OPEN**

Hand the bundle to the Gradle and Xcode projects PRD-047 Phase 1 imported.

**Gate:** a scaffolded project builds an APK that launches on the emulator and passes a
PRD-045 device scenario. **iOS is no longer blocked** — PRD-047 Phase 5 passed on the hosted
Apple runner in run `31313092745` at `e38439c`, which was the prerequisite. What stays open is
iOS *distribution* execution on its own terms: the simulator archive published by the release
lane, consumed by a packed project with Xcode masked. That is separate evidence from the
Android result and is not inherited from it.

The packed Android runtime downloads five checksum-locked release entries before writing
anything: runtime + SDL JNI libraries for `arm64-v8a` and `x86_64`, plus SDL's Java AAR.
Gradle detects that complete set, disables CMake/externalNativeBuild and Rust physics builds,
and packages the four JNI libraries directly. Missing, partial, or checksum-mismatched sets
fail closed. The prepared release consumer uses an SDK view containing no `ndk/` or `cmake/`,
builds normal/masked/wrong-gravity variants, and drives the normal plus four control outcomes
on an x86_64 emulator. It remains open until that workflow actually runs against released
assets.

The budget measurement taken during this phase was 53,851 native-runtime lines, 3,851 above
the nonfatal 50,000-line review trigger. **That number is stale and must be re-measured before
criterion 6 is judged** — PRD-049's final gate later the same day recorded 52,280 after its
207-line proof deletion, and PRD-046's Phase 5 re-run recorded 51,563. Three different figures
dated 2026-08-09 exist across three PRDs; the executor runs `pnpm budgets` and justifies the
crossing against the number it actually prints, never against one quoted here. The crossing
stays visible either way. Phase 0 deleted 1,159 unreachable
demo-distribution lines, and the distribution additions that remain are each exercised by a
consumer boundary: the five-asset transaction, the no-toolchain Gradle branch, or their
fail-closed tests. No C++ was added by this PRD; deleting any of those paths would reopen the
consumer or checksum gates, so the kill-switch pass retains them.

The 2026-08-09 asset-cache repair retains only the shared generated-root wiring, APK entry
hash check, and regression coverage. The hash check closes a false-green boundary: Gradle
previously restored a stale `mergeDebugAssets` output even though the source bundle metadata
was current. Removing the check would let that exact failure pass again; duplicating the
bundle into the source tree was deleted. The change adds no package, C++, or user-facing API.

### Phase 5 — templates, docs, and the WASM trap — **COMPLETE 2026-08-09**

Template `package.json` scripts gain the native targets; the docs state plainly which
targets have real evidence and which are emulator-only.

**A template is not mobile-ready just because it builds.** The platformer imports
`recast-navigation`, which is WASM and dead on the runtime's QuickJS Android engine
(PRD-046 §1). The normal physics entry now selects native Rapier and its Android bundle is
free of Rapier WASM; platformer remains blocked by Recast. **Any scaffold this phase labels
mobile-ready must contain neither Rapier WASM nor Recast WASM in its native bundle**, and a
template that cannot meet that is documented honestly rather than quietly shipped as mobile.

---

## 4a. What is actually left, in execution order

Phases 0–2 and 5 are complete. Everything below is inside Phases 3 and 4, and the order is a
dependency chain, not a preference — each step's output is the next step's input.

1. **Run the corrected release tag.** `native-release.yml` at `0.1.9`, which adds `sdl3` to
   the clean Android dependency set. The fix is locally proven (isolated `--only sdl3`
   download, uncached `compileReleaseJavaWithJavac`, `assembleRelease` on both ABIs);
   nothing here counts until the tag runs end to end. **Gate:** three desktop runtimes,
   both Android ABIs with exported native-physics symbols, and the iOS simulator archive all
   published, with one checksum lock covering exactly the assets that exist.
2. **Land the checksum lock against real assets, never before.** §6's kill condition owns
   this: a manifest that 404s passes review and fails users.
3. **Publish to the registry in this order:** runtime assets + lock → the complete template
   dependency set → `runtime-native` → `create-threenative`. Two known snags inside step 3:
   the templates' UI pin still needs coordinating to `0.1.12` (the registry's `0.1.0`–`0.1.11`
   are an incompatible predecessor), and `threenative-sculpt-mcp@0.1.0`, which the templates
   pin, is absent from npm.
4. **Prove the clean machine.** `pnpm create threenative` then `pnpm build --target desktop`
   with no CMake, NDK, Xcode or Rust. This is acceptance criterion 2 and PRD-046's criterion
   4 simultaneously — the literal `pnpm create` path, not a local tarball. Demonstrate both
   failure controls in the same pass: a corrupted checksum fails the install, and an
   unsupported `platform-arch` names itself in the error.
5. **Run the released consumers on device.** The prepared Android emulator lane against
   *released* assets with an SDK view containing no `ndk/` or `cmake/`, plus iOS distribution
   execution against the published simulator archive.

**Publishing is one-way.** Steps 1–3 burn version numbers that can never be reused, and an
`npm publish` cannot be undone — the UI package already reserves `0.1.12` because of exactly
this. Do a `--dry-run` of every package first, confirm the release order above, and confirm
with the repo owner before the first real publish. Registry commands use the repository-local
`.npmrc` (`npm --userconfig .npmrc <command>`); never print its contents.

**Evidence-status correction carried into these steps:** the failed run `31314171195` did
build, run, capture and stage desktop runtimes on real Linux, macOS arm64 and Windows x64
runners. Those three lanes therefore have real-runner *execution* evidence and lack only
*published artifact* evidence — a weaker gap than Phase 2's blanket "macOS and Windows
remain OPEN", and they must be reported at that precision rather than either extreme.
Physical hardware remains open with no path to close here.

---

## 5. Acceptance criteria — consumer-scoped

1. `threenative build --target web` is byte-identical to `vite build` on all three
   templates, with every template playtest passing unedited.
2. A clean machine with no CMake, NDK, Xcode or Rust scaffolds a project and builds a
   running desktop binary.
3. A corrupted checksum fails the install; an unsupported platform fails with its name in
   the error. Both demonstrated, neither asserted.
4. `packages/runtime-native` ships no C++ source to consumers.
5. CLI command count is **1 implemented of the 4 allowed**; `--target` is a flag, and no
   second top-level command was added.
6. Native LOC remains visible against the 50,000-line review trigger; any crossing is
   justified and survives a kill-switch pass.
7. `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` green on a machine with no
   native toolchain.
8. Every target's evidence is labelled with what produced it — real runner, emulator, or
   simulator — and macOS, Windows, iOS and physical hardware are listed at the precision
   §4a states, not rounded up to passed or down to untried.
9. A packed consumer installs the *released* Android and iOS assets and runs them — the
   emulator lane against an SDK view with no `ndk/` or `cmake/`, and the simulator archive
   with Xcode masked. A local-tarball handoff does not satisfy this.

---

## 6. Kill conditions

- A consumer needs any native toolchain to build a desktop target → the phase has not
  shipped, whatever else is green.
- Distribution requires a fifth top-level CLI command → the design is wrong, not the cap.
- `--target web` diverges from `vite build` in any respect → revert; the web lane has the
  only real users.
- The checksum lock is landed before the release assets exist → remove it; a manifest that
  404s passes review and fails users.
- Deleting Phase 0's scripts breaks `native:build` or the Android proof → `bundle.mjs` was
  on the list by mistake; restore it and re-scope.

---

## 7. A note on PRD counting

The Charter defines no numerical PRD budget. `pnpm budgets` reports direct `docs/PRDs/`
files for visibility; this subfolder is an organizational sequence, not a cap workaround.

## Budget justification

2026-08-10: PRD-048 owns the native packaging, Android/iOS consumer, build-script, manifest,
and release-test portions of `android/`, `ios/`, `scripts/`, CMake, and `tests/`. The exact
61,351-line measurement, commit attribution, and kill-switch table are in
`docs/verification/native-loc-trigger-2026-08-10.md`. These lines stay because they make the
no-toolchain packed consumer and checksum/failure controls executable; deleting them would
turn distribution claims into manual assertions. The trigger remains a review trigger and no
limit was changed.
