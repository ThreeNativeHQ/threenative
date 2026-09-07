# Bayview startup repair — 2026-09-07

Status: Android startup and movement proven on the physical Pixel 8. Required source checks pass.

## Corrected diagnosis

The preserved failed candidate APK explicitly selects `raw-assets.manifest.json` in
`defineGame`, while its packaged assets contain only `assets.manifest.json`. The latter
maps `models/enemy-terrorist.glb` to its hashed output. The loader honors the selected
manifest; this is a game configuration failure, not evidence that core ignores the map.

The repaired game is `/home/joao/projects/threenative/sandbox/prd360-bayview-manifest-fix`.
It removes the stale manifest override and includes the legacy textures and audio in the
asset compiler source tree. All 57 requested logical paths are covered by 74 entries.
The original candidate directory and baseline APK were preserved.

## Engine defects exposed by the repair

- The CLI rejected the existing asset compiler audio option. The public configuration now
  accepts the full option shape and validates it with the compiler parser, forwarding the
  declaration unchanged so `audio: "none"` really preserves bytes. Ten regression tests fail
  before the fix and pass afterward, including an actual compile with a conditioning control.
- The native UI build could bundle two physical React copies through linked dependencies.
  The build deduplicates React and ReactDOM while preserving project dedupe entries. An
  actual linked-package build fails identity checks before the fix and passes afterward.
  The rebuilt Bayview HUD mounts in Chromium with no page errors.
- The native game bundle could likewise contain two physical Three.js copies. Its renderer and
  material then used different TSL stacks, followed by a wgpu validation abort. Native bundling
  now deduplicates Three.js while preserving the mobile export condition. A real bundle regression
  fails before the fix and passes after it; the corrected Android run has no console errors.

## Evidence boundaries

The Android comparison reuses checksum-locked native binaries from the preserved failed
candidate APK, under separate application ID `com.threenative.bayview.manifestfix`. It proves
JavaScript/configuration behavior on that host; it does not claim the C++ binary was compiled
from this task branch. Three interleaved model files are converted to separate vertex layout
in a staging source tree, then compiled normally. Comparison of 2,415,843 accessor values,
180 nodes, 30 primitives, 3 skins, 16 animations, materials and texture bytes finds no semantic
differences. All 30 audio cues preserve their authored bytes.

The 8-second PRD-360 startup criterion, runtime prebuilt release, Android ellipse conformance,
unattributed startup cost and Actions cache occupancy are not established by these fixes.

## Android result

`android-playtest.json`: exit 0, diagnostics passed, movement **2.146719 m** (required 0.25 m).
The APK contains the exact corrected bundle (SHA-256 in `proof.json`). `android-world.png` shows
buildings, sky, a character, weapon and the complete HUD. The first frame arrived at **16,020 ms**;
this is not an 8-second startup result. The runner's timeout was explicitly 60 seconds.

The first unobstructed attempt was invalidated when another app took the foreground. After the
owner left the phone idle, the uninterrupted run passed. Android's existing 16 KB compatibility
warning dimmed the automated screenshot; dismissing its OK button revealed the world shown in
`android-world.png`. No lighting, material, render-stage or exposure setting was changed.

## Review and verification

The review confirmed both configuration forwarding and UI dedupe were correct. Its concrete
public audio type mismatch (`seamThreshold` versus `seamMaxRatio`) is corrected; template
instructions now mention `audio: "none"`. Additional hypothetical UI test expansions were not
needed to establish the executed real-HUD result.

The `*-red.log` and `*-green.log` files record the failing and passing regression runs. The
candidate source patch and promoted-file hashes are retained beside the native proof. Large APKs
and full host logs stay in the local working evidence at `artifacts/findings-fix/`.
Final integrated checks: `pnpm typecheck` exit 0; `pnpm lint` exit 0 (652 existing warnings);
`pnpm test` exit 0, including 402 passed / 2 skipped root test files and 4,491 passed / 7 skipped
root tests. Package checks, including the locally built Linux V8 and QuickJS native suites, also
passed in that command. `pnpm build` and `pnpm budgets` passed; the final evidence-budget check
passed after adding these artifacts. See `gates.json` for the exact log identities.

The native test prerequisite build exposed an intermittent QuickJS GPU timestamp test under
parallel contention; isolated reruns and the final integrated run passed. This caveat remains in
the working evidence rather than being represented as a source fix.

