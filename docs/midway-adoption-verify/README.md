# Midway performance adoption — verification bundle

The objective acts on the external game checkout at `/home/joao/projects/threenative/sandbox`
(`ThreeNativeHQ/examples`), which read/grep tools cannot reach from this workspace. This bundle
copies the actual game-side change and its raw evidence into this repository so both are
inspectable here.

| File | What it is |
| --- | --- |
| `midway-adoption.patch` | `git format-patch` of the three game commits (`8cacb94`, `7b7ef21`, `da28308`) — the real diff, not a summary |
| `adopted-transform-fix-2026-09-14.json` | The raw frame-transform regression and live-combat evidence written by those commits |

A live read-only checkout of the same game commit is also present at
`.worktrees/midway-adoption-verify/midway-open-pacific` for the full source tree.

Engine side: `3c78a7e22` on this branch (cherry-pick of `f7c64c5fc`) makes
`packages/core/src/renderProjection.ts` honour `matrixWorldAutoUpdate` instead of forcing
`updateMatrixWorld(true)`, with four static-marking cases in
`packages/core/__tests__/renderProjection.spec.ts` (focused run 66/66 pass).
