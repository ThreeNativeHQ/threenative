---
prd_contract: v1
---

# PRD-266 — the hot-reload proof and the browser lane run somewhere

**Status:** PROPOSED — filed 2026-08-30 from CI's first working browser lane.

**Goal: `pnpm test:browser` can pass, and the hot-reload proof proves something.**
Two defects found by making CI run a lane it had never executed. Neither is CI plumbing; both are
the framework's own, and both were invisible for the same reason.

## 1. The hot-reload proof never observes a reload

`tests/browser/hot-reload.spec.ts` edits `src/entities/Player.ts` in the served starter project and
waits for `__THREENATIVE__.hot().reloads` to reach 1. It never does:

```text
Error: HMR reload 1 was not observed within 90 seconds:
{"diagnostics":{"reloads":0,"entities":3,"sceneObjects":38,"canvases":1,
 "audio":{"pooled":0,"queued":0,"voices":0},"physics":4},"entities":[...]}
```

Everything else is healthy — three entities, a physics world with four bodies, one canvas. The game
is running and has hot-reloaded zero times.

**It is not the environment.** The same failure reproduces on an ordinary Linux filesystem with
`CI=true`, so it is not a container's inotify. It is not the deadline either: 15s and 90s fail
identically. The template does wire the path — `import.meta.hot?.accept()` and
`acceptHotUpdate(game, import.meta.hot)` in `templates/starter/src/main.ts` — and the spec writes to
the project the server is actually serving, through the same shared path file the config writes.

The likely shape, unproven: the edit invalidates a module with no accepting parent, so vite full-
reloads the page instead of hot-updating it. A full reload restarts the game and leaves `reloads` at
zero, which is exactly what the counter shows. **Confirm that before fixing anything** — `reloads: 0`
is also what a broken counter looks like, and this PRD must not repair the wrong one of the two.

Whatever the cause, the shipped claim is that a game hot-reloads while preserving its state. Today
nothing proves it.

## 2. `pnpm test:browser` cannot pass on a developer machine

`verifyWebGpuProjects` launches Chromium through `chromium.launch({ args })` with no `headless:
false`, so it runs headless and Chromium serves WebGPU from SwiftShader. `allowSoftwareAdapter` is
`process.env.CI === "true"`, so off CI the sweep demands a hardware adapter that a headless launch
cannot give it:

```console
$ DISPLAY=:0 pnpm test:browser
Error: WebGPU lane root browser/abyss-vanilla selected a software adapter (fallback).
```

That is on a machine with an RTX 2080 and a real display. The gate is therefore red for every
developer who runs it locally and green only where software adapters are tolerated — which is why a
spec that has never worked sat unnoticed. A gate nobody can run locally is a gate nobody runs.

Either the sweep launches headed under a display the way the playtest runner already does, or the
hardware requirement moves to where it can be met. Whichever is chosen, `pnpm test:browser` must be
runnable by a person on their own machine.

## Why both were invisible

CI had never completed a single run in its history, so the browser lane had never executed. The
hot-reload defect most likely dates to the menu screen flow
([PRD-218](../done/batch-2026-08-24-menu-screen-flow/PRD-218-scene-screens-and-menu-flow.md)); the spec
also walked straight past the main menu into a scene with no player, which was fixed in `144c6f81`
and is what let this second failure surface at all.

Recorded in [ci-has-never-been-green-2026-08-29](../../verification/ci-has-never-been-green-2026-08-29.md).

## Acceptance criteria

- [ ] `pnpm test:browser` passes on a developer machine with a GPU, with the adapter it used named
      in the output.
- [ ] The hot-reload proof observes ten reloads, or the claim it tests is withdrawn from the docs
      that make it. A proof that cannot pass is deleted or repaired, never left red.
- [ ] Whichever of the two causes in §1 is real is stated with its evidence, and the other is ruled
      out in the same record.
- [ ] `test-browser` green on CI, and the run names the adapter it had.
