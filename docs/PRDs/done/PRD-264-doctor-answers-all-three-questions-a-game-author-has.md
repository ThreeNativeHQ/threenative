---
prd_contract: v1
---

# PRD-264 — doctor answers all three questions a game author has

**Status:** DONE — filed 2026-08-29, landed in `273672e1`, re-verified on `main` at `07dfaf63`.
Evidence in [doctor-2026-08-29](../../verification/doctor-2026-08-29.md);
`packages/create-threenative/__tests__/doctor.spec.ts` is 42/42 green, and a live probe against a
project whose `threenative-engine` server cannot resolve fails naming `threenative-engine-mcp`.
Was independent of the publish chain.

Seventh lane of [the release batch](../batch-2026-08-29/README.md). Moves no alpha-bar row, and is in the batch anyway:
`threenative doctor` is the only diagnostic a user with just the library installed can run, and it
currently under-reports two of the three things they are trying to do.

**Goal: the one command a stranger runs tells them the truth about crafting, testing and shipping
their game — and names what is missing, not merely what is absent.**

**Complexity:** +2 (6–10 files across two packages) +1 (a process launch in a check) +1 (a package
seam that must not become a dependency) = **4 → MEDIUM mode.**

## The problem, measured today

Run in `sandbox/last-harvest`, an installed game with all packages at 0.3.0, using its own
`node_modules/create-threenative/dist/threenative.js`:

```text
✓ package.json: readable
✓ dependencies: 6 installed
✓ versions: all at 0.3.0
✓ native entry: src/game.ts default-exports a game
✗ native runtime: unavailable — linux-x64: Prebuilt release manifest fetch failed for 'linux-x64'
    at .../runtime-native-v0.3.0/prebuilt-lock.json: HTTP 404.
    fix: Fix the recorded prebuilt download failure, then run npm install again.
✓ target web: available — src/main.ts
✗ target desktop: unavailable — linux-x64: ... HTTP 404.
✓ target android: available — runtime packager installed; Android SDK and JDK are checked by build
! target ios: unavailable — iOS simulator packaging requires darwin-arm64; received linux-x64
✓ web entry: src/main.ts is the web entry
✓ playtests: at least one scenario can prove this game
✓ capability search: capability search is wired for an authoring agent
```

Twelve checks. Sorted by the user's three goals:

| Goal | Checks | What they actually test |
| --- | --- | --- |
| **Ship** | 7 — native entry, native runtime, four targets, web entry (+ APK size and desktop overlay when applicable) | real behaviour. This half works: it caught the 404 and named the fix |
| Baseline | 3 — package.json, dependencies, versions | real |
| **Test** | 1 — `playtests` | `files.some(f => f.endsWith(".playtest.json"))` |
| **Craft** | 1 — `capability search` | `snapshot.files.has(".mcp.json")` (`doctor.ts:592`) |

### Defect 1 — `capability search` is a green that cannot go red for the real reason

The check stats a file. It never launches a server and never asks whether the package behind it
resolves. `packages/core/mcp/servers.mjs:35` names `threenative-engine-mcp@0.2.0` as the npx
fallback, and that package is **E404 on the registry today**. A stranger's project would print
`✓ capability search` while the capability tools were unreachable.

This is the check whose failure matters most. The repository's first working rule is *ask what
exists before you write a system*; the cited cost of not doing so is a game that hand-wrote 446
lines that were already installed and ran at 9 FPS. The one check standing between an agent and that
outcome is a `files.has`.

The other two servers are fine and should be checked the same way: `threenative-asset-mcp@0.4.0`
and `threenative-sculpt-mcp@0.1.0` both resolve on the registry.

### Defect 2 — nothing checks the asset pipeline at all

```text
$ grep -c "asset\|audio\|public/\|sharp\|pipeline" packages/create-threenative/src/doctor.ts
0
```

`ensure-mcp.mjs` writes `ASSET_DOWNLOAD_DIR=./public/assets` and `AUDIO_DOWNLOAD_DIR=./public/audio`
into every project's `.mcp.json`. Nothing verifies those directories are writable, that the asset
server starts, or that the compiled-asset settings in the project config agree with the targets the
game builds for — a mismatch the *build* refuses loudly (`TN_NATIVE_KTX2_UNSUPPORTED`,
`TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED`) and the doctor never mentions.

### Defect 3 — the checks that would prove a game is testable live in a different program

`packages/playtest/src/runner/doctor.ts` checks node, display, playwright, chromium, `adb`, and
device thermal/battery/charging. `threenative doctor` does not call it and does not mention it.
A user with only the library installed has no path to discovering it exists.

`create-threenative` must **not** take a runtime dependency on `@threenative/playtest` to fix this —
its runtime deps today are the glTF/texture toolchain only, and playtest carries browsers. The seam
is the installed `threenative-playtest` bin, or nothing.

### Defect 4 — a known trap is deferred to a cryptic build error

`✓ target android: "... Android SDK and JDK are checked by build"`. A JDK that is too new fails
Gradle with a bare version string and no explanation. Doctor knows Android is the target and says
nothing about the toolchain it needs.

## Solution

Four checks, each replacing an existence test with a probe, and one delegation. **Doctor stays a
diagnostic**: it may launch a server and time it out, and it may not install anything, write to the
project, or run a build.

**Data changes:** none.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | MCP server probe | `diagnoseProject` in `src/doctor.ts` | the `.mcp.json` `files.has` check | yes, same commit | uninstall `threenative-engine-mcp` and block npx → the check fails naming the package |
| 2 | asset-pipeline check | `diagnoseProject` | nothing | n/a | make `public/assets` unwritable → warn with the path |
| 3 | playtest-runnability delegation | `diagnoseProject` | the `*.playtest.json` `files.some` check | the existence check is folded into it | remove `node_modules/.bin/threenative-playtest` → the check reports the runner missing, not "ok" |
| 4 | JDK/SDK check on the android target | `targetChecks` in `src/doctor.ts` | the "checked by build" deferral | yes | point `JAVA_HOME` at an unsupported JDK → the android target warns before a build is attempted |

## Execution phases

#### Phase 1: `capability search` probes the servers it claims are wired

**Files:** `packages/create-threenative/src/doctor.ts` (EDIT),
`packages/create-threenative/__tests__/doctor.spec.ts` (EDIT), the record.

- [x] For each of the three servers in `.mcp.json`, resolve the package the way `launch.mjs` does —
      walk `node_modules` upward from the project — and report per server, not once for the file.
- [x] A server whose package is not installed is **not** a pass. Report it as reachable-by-npx only,
      and name the package and version so the reader can check the registry themselves.
- [x] Report a malformed or hand-edited `.mcp.json` distinctly from a missing one.

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `__tests__/doctor.spec.ts` | `should fail capability search when the engine server package is absent` | the check names `threenative-engine-mcp` | restore the `files.has` check → the spec reds |
| `__tests__/doctor.spec.ts` | `should report each of the three servers separately` | three named results from one `.mcp.json` | collapse to one → red |

**Revert check:** restore the `files.has(".mcp.json")` line → both specs red. Paste it.

#### Phase 2: the asset pipeline is checked where it is configured

**Files:** `src/doctor.ts` (EDIT), `__tests__/doctor.spec.ts` (EDIT), the record.

- [x] Check the two download directories `ensure-mcp` configures exist or can be created.
- [x] Check the project's compiled-asset settings against the targets it declares, and warn with the
      **same error name the build would emit** (`TN_NATIVE_KTX2_UNSUPPORTED`,
      `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED`) so the two diagnostics are searchable as one thing.

**Revert check:** set `assets.textures` to a compiled format with `android` among the targets →
the check warns, and the build refuses with the matching name. Paste both.

#### Phase 3: doctor delegates the testability question

**Files:** `src/doctor.ts` (EDIT), possibly `packages/playtest/src/runner/doctor.ts` (EDIT to expose
a text mode already present), `__tests__/doctor.spec.ts` (EDIT), the record.

- [x] Detect the installed `threenative-playtest` bin. **No runtime dependency on
      `@threenative/playtest` is added** — assert that in a spec over `package.json`.
- [x] When it is present, run its doctor and fold the result in under a `playtest` heading. When it
      is absent, say so and name the install command.
- [x] Keep the scenario-existence check as one line inside the folded result, not as the whole answer.

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `__tests__/doctor.spec.ts` | `should report the playtest runner as missing rather than passing` | named failure | keep the `files.some` check → red |
| `__tests__/doctor.spec.ts` | `should not add a runtime dependency on the playtest package` | `dependencies` has no `@threenative/playtest` | add it → red |

**Revert check:** delete `node_modules/.bin/threenative-playtest` in a fixture → the check reports
missing. Paste it.

#### Phase 4: the android target names its toolchain

**Files:** `src/doctor.ts` (EDIT), `__tests__/doctor.spec.ts` (EDIT), the record.

- [x] Resolve the JDK and Android SDK the Android build would use and report the versions found.
- [x] Warn, with the supported range, when the JDK is one Gradle will reject. **The message names the
      version found and the range required** — the failure this replaces is a bare version string.

**Revert check:** point `JAVA_HOME` at an unsupported JDK → the android target warns instead of
passing. Paste the warn and the build error it predicts.

## Acceptance criteria

- [x] Running `threenative doctor` in a project whose `threenative-engine-mcp` cannot resolve
      **fails or warns naming that package**. This is the acceptance criterion the whole PRD exists
      for; it is checkable today, because the package is E404 right now.
- [x] Every check answers one of *craft*, *test*, *ship*, and the report groups them so a reader can
      see which of the three is unhealthy without reading twelve lines.
- [x] No check installs anything, writes to the project, or runs a build.
- [x] `create-threenative` gains no runtime dependency on `@threenative/playtest`, asserted by a spec.
- [x] Every phase pastes its red and its green in the same commit.
- [x] Re-run in `sandbox/last-harvest` and paste the before/after report side by side.
