# PRD-143 physics joints — completion evidence

Date: 2026-08-18

`Joint3D` now constrains bodies through the shared web/native simulation seam. The public node is
one class with pin, hinge and fixed factories; the native path uses the bulk transform ABI.

| Gate | Result |
| --- | --- |
| `pnpm vitest run packages/physics/__tests__/joint.spec.ts` | PASS — 7 tests |
| `pnpm test` | PASS — 144 files, 1,306 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS — warning-level complexity diagnostics only |
| `pnpm budgets` | PASS — 77,049 native LOC; the review trigger is reported and the native joint lines are owned by PRD-143 |
| web hinged-door scenario | PASS — the door rotated on its hinge and respected the limit |
| desktop hinged-door scenario with `--target desktop` | PASS — 120 fixed ticks, angle `0.1594762887` radians, off-axis rotation `0`, zero diagnostics |
| `pnpm native:verify:desktop` | PASS — 300-frame desktop core proof, desktop physics playtest, and 14 assertions |

The desktop hinged-door run used the shared runner and a packaged native executable:

`sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js examples/native-smoke/.tmp-prd143-hinged-door.playtest.json --project . --target desktop --executable /tmp/tn-prd143-desktop.moGy0d/joint-game --artifacts /tmp/tn-prd143-desktop.moGy0d/artifacts-r7`

The temporary probe and executable were removed after the run. The required behaviour is also
covered by the committed web/native joint tests and the desktop verifier.
