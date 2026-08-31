# CI red board — 2026-08-31

What ran, what it proved, and what is still unproven, for the two GitHub workflows on `main`.

Baseline: run `33422413808` (`CI`) and `33422413795` (`Native platform evidence`), both on
`a8c056d1`. `CI` had never been green that day; `Native platform evidence` has **never** been green
at all — 28 failures and 9 cancellations across the last 100 runs, 0 successes.

## `CI` — two red jobs, both closed

| Job | Was | Cause | Now |
| --- | --- | --- | --- |
| `lint` | fail | Two Biome **formatter** diffs in `scripts/verify-registry-install.ts` and `scripts/render-chain-capabilities.ts`. Not rule violations — `biome check` reports formatting as an error, so `pnpm lint` exited 1 while its 496 warnings were never the problem. | `pnpm lint` exits 0 |
| `test` | fail | `device-playtest.spec.ts` and `ios-device-playtest.spec.ts` ran `device-smoke.playtest.json` against fake bridges that emit `player`. `847f80cf` had correctly renamed the scenario's movement entity to `multitouch-player` — the id the native-smoke scene actually registers — without updating the two fixtures. | 27/27 pass |

`budgets` went red mid-session on `dd3a4b7e` and was closed the same day; see below.

## `budgets` — three gates, one commit

`dd3a4b7e` added `pnpm --filter @threenative/core build` to the Android parity job and two `.mjs`
cases under `runtime-native/tests/`. The build step was the right fix. It left three generated
records behind, each failing `pnpm budgets` in turn:

1. **Literal package enumeration.** A workflow may not name workspace packages by hand. Replaced
   with `pnpm tsx scripts/workspace-packages.ts build`, the form `ci.yml` already uses everywhere,
   which also covers scenes importing packages other than core.
2. **Native coverage digest.** `nativeCoverageEvidenceDigest` hashes *every* file under
   `runtime-native/tests`, `.mjs` included, so two JS test edits staled a C++ line-coverage record.
   Regenerated twice — numbers unchanged both times, digest only.
3. **Native census.** `tests/` measured 26,637 against 26,621 recorded, the same 16 added lines.

Note for whoever owns the digest: a `.mjs` harness edit forcing a full instrumented native rebuild
is a real cost. It cost two rebuilds here, one of which timed out under load
(`threenative-worker-production-test: spawnSync ctest ETIMEDOUT`) and needed a quiet machine.

## `Native platform evidence` — one blocker removed, two untouched

### Android emulator visual parity — root cause found

The web reference capture reported **15 failures**. They were two causes, not fifteen:

- **1** — `76-gpu-scene-bvh` failed at phase `bundle` on `Could not resolve "@threenative/core"`.
  The job never built the workspace. Fixed by `dd3a4b7e`'s build step.
- **14** — every row setting `requiresHardwareAdapter` threw
  `TN_CONFORMANCE_HARDWARE_ADAPTER_REQUIRED`. A GitHub-hosted runner exposes SwiftShader:

  ```
  01-basic-cube adapter: {"architecture":"swiftshader","vendor":"google"}
  ```

  The catch recorded these as `fail`, which claims 13 realism effects and the probe-volume sample
  were measured and came out wrong. They were never executed. Run here on real hardware:

  ```
  realism-ssr status: pass | adapter: {"architecture":"turing","vendor":"nvidia"}
  ```

  So the lane was asserting an engine defect that does not exist, in the direction that looks worst.

**Closed by** classifying an adapter refusal as `blocked` — the same way `runBrowser` already treats
a missing Xvfb or Chromium — and then naming which blocks the lane accepts. `unexpectedBlockedRows`
permits a hardware row blocked on a software adapter and a row the registry has not implemented, and
returns everything else; `check-lane-blocks.mjs` fails the step on any failure or any other blocked
row, so a row that breaks for a new reason cannot hide inside the allowance.

Proof is a fixture cut from the real failing report: 15 blocked, 0 unexpected, and a row blocked for
any other reason is returned. Mutation-checked — reverting the guard in `hardwareAdapterBlocker` to
`return null` fails the test with `expected /Requires a hardware GPU adapter/, received null`.

The ledger step ran on `always()` and died with a bare `ENOENT` stack whenever an earlier step meant
the emulator never ran, burying the real cause. It now raises `TN_PARITY_ANDROID_REPORT_MISSING` and
points at the step that actually failed.

**Still unproven.** The emulator step has never once executed in CI — every run skipped it because
the capture step failed first. This removes that blocker; it does not prove the lane green.

### Windows desktop core — NOT EXECUTED HERE

`TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED`, twice, after `desktop physics playtest proof
passed: 14 assertions`. Needs a Windows runner. No claim made.

### iOS simulator — NOT EXECUTED HERE

`iOS proof missed markers: TN_NATIVE_SMOKE_READY:webgpu, TN_NATIVE_SMOKE_FIRST_FRAME,
TN_NATIVE_SMOKE_300_FRAMES:300` — the app built and never rendered. Needs macOS and Xcode. No claim
made.

### macOS desktop core, Scaffolded starter desktop artifact

Both green on the current run; starter was red on the baseline.

## Gates run locally

```
pnpm lint         exit 0
pnpm typecheck    exit 0
pnpm budgets      exit 0
vitest packages/core/__tests__                    811 passed (83 files)
vitest device-playtest + ios-device-playtest       27 passed
vitest create-threenative/__tests__/template.spec  32 passed
vitest runtime-native tests/conformance-runner     48 passed
pre-push ci:fast  lint/docs/typecheck/budgets/agents/drift all pass
```

Not run here: the Android emulator lane, the Windows lane, the iOS lane.
