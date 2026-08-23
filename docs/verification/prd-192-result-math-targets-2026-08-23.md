# PRD-192 verification — result-bearing math has reusable targets and repaired hot paths

- Date: 2026-08-23
- Lane: `lane-192`
- Worktree: `prd-192-result-math-targets`

## Repair scope

The review of commit `3e4e2e7c` found two remaining `PathFollow3D` target-path allocations. The repair keeps the public signatures and callers unchanged, mirrors Three.js `Curve.getTangentAt` semantics with two retained tangent vectors, and replaces projection array helpers with direct finite checks and an index loop.

## Negative controls and focused specs

The required baseline command was run before the implementation:

```text
pnpm exec vitest run packages/core/__tests__/picking.spec.ts packages/core/__tests__/viewport.spec.ts packages/core/__tests__/path-follow.spec.ts packages/physics/__tests__/navigation-agent.spec.ts
```

It was red with five new target-identity failures: picker result target, viewport targets, path-follow sample/projection targets, navigation next-position target, and crowd request record identity.

The same command after the implementation was green: 4 test files and 34 tests passed. Template unit coverage also passed: `racing.spec.ts`, `defense.spec.ts`, and `scaffold.spec.ts` completed with 3 files and 35 tests passed.

The repair-specific red/green control was then run:

```text
pnpm exec vitest run packages/core/__tests__/path-follow.spec.ts
```

Before the repair, the added 8-test probe was red with 2 failures: `passes targets through Three.js tangent sampling` observed an undefined `getPoint` target, and `keeps repeated target projections off allocation-producing array helpers` observed `Array.prototype.every`/`entries` calls. After the repair, it was green with 8 tests passed. The final focused command was green with 4 files and 36 tests passed.

## Browser WebGPU checks

- Racing: a temporary scaffold ran the full racing playtest suite with `--browser-recipe webgpu`; it passed with exit code 0 on the NVIDIA/Turing adapter and reported `rendererKind: webgpu`.
- Defense: the template playtest run reported `defense: scaffolded playtests passed` on the NVIDIA/Turing WebGPU adapter.
- Racing and defense repair rerun:

  ```sh
  sh scripts/xvfb.sh pnpm exec tsx -e 'import { spawn } from "node:child_process"; import { mkdtemp, rm } from "node:fs/promises"; import os from "node:os"; import path from "node:path"; import { createProject } from "./packages/create-threenative/src/index.ts"; import { packageLocalFramework } from "./scripts/visual-gate.ts"; const run = (cwd: string) => new Promise<void>((resolve, reject) => { const child = spawn("pnpm", ["test"], { cwd, stdio: "inherit" }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`template test exited ${code ?? "unknown"}`))); }); (async () => { const root = await mkdtemp(path.join(os.tmpdir(), "threenative-prd192-repair-")); try { const packageSources = await packageLocalFramework(root); for (const template of ["racing", "defense"] as const) { const target = path.join(root, template); await createProject({ install: true, packageSources, target, template }); await run(target); console.info(`${template}: scaffolded playtests passed.`); } } finally { await rm(root, { force: true, recursive: true }); } })();'
  ```

  Both temporary scaffolds exited 0 on NVIDIA/Turing WebGPU with `rendererKind: webgpu`; output included `racing: scaffolded playtests passed.` and `defense: scaffolded playtests passed.`.
- Navigation: the direct headed command first exited 2 before frame 0 because this headless shell had no X server. The corrected command was `sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/navigation.playtest.json --url 'http://127.0.0.1:5181/?navigation' --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5181 --strictPort" --browser-recipe webgpu --headed`. It reached the intended scene on NVIDIA/Turing WebGPU, with `pathLength: 9.725507065552236`, `closestDistance: 0.006768826545260287`, and diagnostics passing. The command exited 1 only because the existing fixture rejects an already-true visibility assertion as trivial and its blank-capture guard measured a 0.02062 bright-pixel ratio against 0.05; no fixture file was changed.
- The aggregate `pnpm test:templates` run passed action-rpg and defense, then was stopped after platformer scenario 17 remained hung for more than 8 minutes. No racing, defense, or navigation implementation failure was reported by that aggregate run.

## Repository gates

- `pnpm install --frozen-lockfile`: passed.
- `pnpm build`: passed; the regenerated capability manifest contains 115 entries and includes the reusable `Vector3` navigation target example.
- `pnpm typecheck`: passed.
- `pnpm lint`: exit code 0 with 239 repository warnings; the repaired files introduced no lint errors.
- `pnpm budgets` and `pnpm quality`: passed with their existing non-fatal review findings.
- `pnpm test`: passed with 166 test files passed and 1 skipped; 1,590 tests passed and 3 skipped. The focused core, physics, and template suites above also passed.

## Scope

The original commit contains the reusable result-target API, callers, and manifests. This repair commit adds only `packages/core/src/path-follow.ts`, `packages/core/__tests__/path-follow.spec.ts`, and this verification record update. No unrelated source or fixture files were changed.
