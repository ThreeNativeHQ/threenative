# PRD-366 phase 3 — published 0.3.3 `next` cohort, per-target rows (2026-09-25)

This is a **per-target verification record against the published registry cohort**, not the
phase-3 collector implementation. Phase 3's own files (`qualify-physical-mobile.mjs`,
`physical-mobile-qualification.test.mjs`) and the physical-Android row remain open; nothing below
claims a target this host did not execute.

Host: Linux 7.2.6-1-cachyos, Node v20.19.6, npm 11.18.0, pnpm 10.25.0, NVIDIA RTX 2080 (Vulkan
1.4.351), Xvfb provided by the playtest runner, Blender 5.2.0 available.

## Published cohort identity

- `npm view` dist-tags: `@threenative/{core,runtime-native,physics,ui,playtest}` → `latest`/`next`
  `0.3.3`; `create-threenative` → `latest`/`next` `0.2.6`.
- `npm create threenative@next my-game -- --template starter --no-install` → `Created starter
  project`, create-threenative 0.2.6, template pins `@threenative/*@0.3.3`,
  `@threenative/runtime-native@0.3.3` (optional), `create-threenative@0.2.6`.
- Install used **pnpm** (the template's own instruction): `pnpm install --store-dir <tmp>`
  → `Done`; `pnpm-lock.yaml` names `@threenative/{assets,core,physics,playtest,runtime-native,ui}
  @0.3.3` and has zero `file:`/`link:` specifiers.

## Targets executed

### Browser / web (Linux)

```sh
pnpm build:web
pnpm exec threenative-playtest --scenario playtests/production-readiness.playtest.json \
  --browser-recipe webgpu --headed --no-screenshots --allow-software \
  --server-command "pnpm dev --host 127.0.0.1 --port $PORT --strictPort"
```

Result: exit 0, `pass: true`, `runtime: web`, `target: web`, scenario
`starter-production-readiness`, **5 assertions, 0 failures**, 941 frames,
`movementDelta [0.0000063, -3.7658666, -3.9999729]`.

Assertion ids: `resource.state.score.atSteps`, `resource.state.entityCount.atSteps`,
`diagnostics`, `movement.axisDelta`, `visibility.player`. Artifact directory
`artifacts/playtest/`.

### Linux x64 desktop

```sh
pnpm build:desktop
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs \
  --consumer --target desktop --project .
```

- Build: `dist-native/my-game`, 142,629,115 B, from the prebuilt
  `prebuilt/linux-x64/threenative-runtime` + `mystral-tools` (140,947,976 B / 137,592,232 B).
- 300-frame gate: `starter desktop gate passed: 300 frames, 22504 colors, 335 asset pixels, brand
  NOT inspected`; report `pass: true`, `overlayAttached: true`, screenshot sha256
  `b16db67bdfada4a8b05daf6e579e04034b3555128028a0afa585502361271e1d`.
- Consumer row (`artifacts/native/consumer-targets.json`): `pass: true`, **5 assertions, 0
  failures**, `artifactHash 85a8202802e0a49f04526f5e6914ca9a4885570a482e5277a28fa3536c6b39d8`,
  app `com.threenative.mygame`, `linux` / `7.2.6-1-cachyos`, `x64`, `session wayland`,
  `scenarioHash 4edb52f1fb8d6ded2159a4d39cb35b48089db917edbe79d3b52109edbf3146ed`. The five ids and
  the scenario hash equal phase 2's recorded set.

## Targets not executed here

| Target | Named proof | Status |
| --- | --- | --- |
| Windows desktop | CI job `native-platforms / Windows desktop core` | **success** on `workflow_dispatch` run [36175962979](https://github.com/ThreeNativeHQ/threenative/actions/runs/36175962979) (`develop`); builds local tarballs, not the published cohort. No Windows host here. |
| macOS desktop | CI job `native-platforms / macOS desktop core` | **success** on the same run, same source-vs-registry limitation. |
| Android physical | `packages/runtime-native/scripts/qualify-physical-mobile.mjs` | Needs the physical device; the owner rule forbids using the phone in this lane. |

## Observed red — npm install of the published template

`npm install` in the scaffolded project fails after fetching the 0.3.3 cohort:

```
npm error path .../node_modules/sharp
npm error command sh -c node install/check.js || npm run build
npm error sharp: Attempting to build from source via node-gyp
npm error sharp: Please add node-addon-api to your dependencies
```

`@gltf-transform/cli@4.4.2` (devDependency in all ten templates, referenced nowhere else)
depends on `sharp ~0.34.5`; that prebuilt does not load on this host. The override was verified
in isolation: `npm install @gltf-transform/cli@4.4.2` with `overrides: { "sharp": ">=0.35.4" }`
completes (`found 0 vulnerabilities`) and `sharp` loads with `vips 8.18.6`, while
`npm install sharp@0.34.5` alone fails the same way. `pnpm` succeeds because
`pnpm.onlyBuiltDependencies` ignores sharp's build script. GHSA-rgj7-g3m4-5g8c covers
`sharp <0.35.4`, so the same pin is a CVE matter, not only an install failure. Owned by PRD-196
(`BLOCKED — requires-release-credentials`); the ten templates still need the override to reach
consumers.

## Remaining

- The npm install failure above (fix forward).

- Phase 3's collector edits and its physical-Android user-verification box.

- Windows/macOS published-cohort rows (CI-owned; a full consumer run against the registry cohort
  on those hosts is not part of this record).

- Independent reviewer PASS for phase 3.
