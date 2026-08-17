# Input vector axis contract — 2026-08-12

Status: executed locally against commit `0fe0e02` plus the PRD-082 working tree. Web browser
and unit evidence ran; no native host or device ran.

## Result

`InputMap.vector()` keeps its compatible contract: up is `+y` for keyboard and a forward
gamepad stick. Its generated declaration now explains that a conventional XZ game maps this
to world `-z`, unlike Godot's `Input.get_vector`, where up is `-y`. The duplicated explanation
was deleted from the minimal and starter generated players; their `-move.y` mappings remain.

Option B, changing the runtime to Godot's sign, was rejected because it would silently invert
every existing keyboard and gamepad caller. No helper, option, or export was added.

## Phase 0 measurement

The PRD's candidate caller was stale. `examples/abyss-framework/src/entities/Player.ts` has no
importer or constructor call. The default URL runs `Abyss`, whose camera looks along `-z` while
the playable lure moves in the XY plane, so camera-forward Z is not a meaningful oracle. A
new scene solely to execute dead code would manufacture reachability instead of test the game.

The durable scenario therefore measures the live registered `player`: press Enter, hold W for
60 fixed ticks, and require world `+y` displacement. The direct headed WebGPU run exited 0
with raw/signed Y delta `+398.880316051173`. Inverting only the scenario oracle to `-y` exited
1 with signed delta `-398.880316051173`. After restoration, `pnpm test:playtest` ran the
existing two scenarios plus this one and exited 0; its final run measured `+400.6782047131857`.

The first manual attempt exited 2 because `-- --host` made Vite bind localhost rather than
`127.0.0.1`. It never reached assertions and is recorded as unmeasured. Removing the extra
separator fixed the command layer.

Phase 2 did not run: the live game is correct, and editing unreachable `Player.ts` cannot
change the measured scenario.

## Unit negative controls

| Mutation | Focused result |
| --- | --- |
| keyboard up changes `vector.y += 1` to `-= 1` | exited 1; expected `1`, received `-1` |
| gamepad forward removes the negation from `axes[1]` | exited 1; expected `1`, received `-1` |

Both mutations were restored. An initial test-name selector containing `+` matched no tests;
the control was rerun with `-t 'up binding is held'` and observed red.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm --filter @threenative/core build` plus declaration grep | pass; JSDoc present in emitted `.d.ts` |
| `pnpm exec vitest run packages/core/__tests__/input.spec.ts` | pass; 11/11 |
| `pnpm test:playtest` | pass; movement-axis scenario included |
| `pnpm typecheck && pnpm lint && pnpm test` | pass; root Vitest run 100 files, 837 tests |
| `pnpm budgets` | pass; 8,832/15,000 framework LOC; existing native review trigger reported |
| boundary/duplication greps and `git diff --check` | pass; no core index diff, no duplicated template comment |

This proves the public TypeScript and web behavior only. It does not prove an input device or
native platform and makes no desktop, Android, or iOS readiness claim.
