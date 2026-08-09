# PRD-048 — shipping a native game: the CLI and distribution lane

**Status: IN PROGRESS. Phases 0–2 and 5 are complete. Phase 3's fail-closed installer and
packed-consumer lifecycle are locally proven, but real release assets/checksum lock and the
clean-machine build remain open. Android Phase 4 is source-workspace emulator-proven; iOS
and the prebuilt consumer handoff remain open.** Split out of PRD-047 §4 Phase 6
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

### Phase 2 — `--target desktop`, from source, on this machine

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

**Gate:** on a clean machine with **no CMake, no NDK, no Xcode and no Rust**,
`pnpm create threenative` followed by `pnpm build --target desktop` produces a running
binary. Separately, a deliberately corrupted checksum **fails the install**, and an
unsupported `platform-arch` fails with that string in the message. Both failures are shown,
not asserted.

### Phase 4 — `--target android` and `--target ios` — **ANDROID SOURCE HANDOFF COMPLETE;
PREBUILT CONSUMER AND iOS OPEN**

Hand the bundle to the Gradle and Xcode projects PRD-047 Phase 1 imported.

**Gate:** a scaffolded project builds an APK that launches on the emulator and passes a
PRD-045 device scenario. **iOS is blocked** on PRD-047 Phase 5 producing any simulator
evidence at all; it does not start on the strength of the Android result.

### Phase 5 — templates, docs, and the WASM trap

Template `package.json` scripts gain the native targets; the docs state plainly which
targets have real evidence and which are emulator-only.

**A template is not mobile-ready just because it builds.** The platformer imports
`recast-navigation`, which is WASM and dead on the runtime's QuickJS Android engine
(PRD-046 §1). The normal physics entry now selects native Rapier and its Android bundle is
free of Rapier WASM; platformer remains blocked by Recast. **Any scaffold this phase labels
mobile-ready must contain neither Rapier WASM nor Recast WASM in its native bundle**, and a
template that cannot meet that is documented honestly rather than quietly shipped as mobile.

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
   simulator — and macOS, Windows, iOS and physical hardware are listed as OPEN until each
   has run.

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
