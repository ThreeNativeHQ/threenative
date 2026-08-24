# PRD-196 published-install verification

Status: **PARTIAL / UNVERIFIED for the external release checkpoint**

Lane: `lane-196`
Date: 2026-08-23
Worktree: `prd-196-published-install-is-functional`

The implementation is committed on the lane branch. The public `runtime-native-v0.3.0`
release was not cut from this lane: the worker is prohibited from pushing or creating releases.
Consequently, the consumer desktop, Android APK, and registry/MCP end-to-end criteria remain
UNVERIFIED. The checks below record what did run and what failed.

## Source and test-path note

The PRD names `packages/runtime-native/__tests__/install-prebuilt.spec.ts`, but this checkout's
active runtime test is `packages/runtime-native/tests/distribution.test.mjs` under the package's
`vitest.config.ts`. That existing test file was extended and run with the package configuration.

## Green implementation gates

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | PASS |
| `pnpm typecheck` | PASS; all workspace package checks completed |
| `pnpm lint` | PASS; 293 report-only complexity warnings |
| `pnpm test` | The first package phase was externally interfered with; its successful resume plus the direct unit phase passed. See repair round 1 below. |
| `pnpm budgets` | PASS; LOC/census messages are existing report-only warnings |
| `pnpm quality` | PASS; 71 report-only findings, including the changed doctor's 467-line file-length report |
| runtime distribution suite | PASS — 16 tests |
| doctor suite | PASS — 16 tests |
| scaffold suite | PASS — 21 tests |
| publish-state suite | PASS — 22 tests |
| registry verifier suite | PASS — 11 tests |
| sandbox suite | PASS — 18 tests |
| engine MCP suite | PASS — 11 tests |

## Repair round 1 — reviewer defects

### Observed red before repair

Commands:

```bash
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts \
  -t "fails the publish report when an optional template pin still uses workspace:"
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts \
  -t "fails when the native verifier produces no 300-frame proof|fails when doctor text omits the target census"
pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts \
  -t "lists web, desktop, Android, and iOS target availability|fails when install status belongs to a stale runtime version|fails when install status names a stale release URL"
```

Output:

```text
check-publish-state: 1 failed, 21 skipped
  expected exitCode 1, received 0

verify-registry-install: 2 failed, 9 skipped
  native verifier control: expected exitCode 1, received 0
  doctor census control: expected exitCode 1, received 0

doctor: 3 failed, 13 skipped
  no check named 'target web'
  stale version: expected report.pass false, received true
  stale URL: expected report.pass false, received true
```

### Green after repair

```text
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts
  Test Files 1 passed (1); Tests 22 passed (22)

pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts
  Test Files 1 passed (1); Tests 11 passed (11)

pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts
  Test Files 1 passed (1); Tests 16 passed (16)

pnpm typecheck
  exit 0

pnpm lint
  exit 0; 293 report-only warnings

pnpm budgets
  exit 0

pnpm quality
  exit 0; 71 report-only findings
```

The first `pnpm test` attempt was interrupted by another repository run changing the global
`/tmp/threenative-*` count from 84 to 87. Its first package-phase resume then observed another
worker's Playwright PID `2080741` after the orphan baseline. No foreign process was killed. Once
that process exited, the recorded package phase resumed successfully:

```text
pnpm gate:resume
  package-test: exit 0
  runtime-native: 50 files passed; 333 passed, 37 skipped
  native physics parity: 28 TypeScript tests and 2 Rust tests passed
  suite temporary directory count unchanged: 85

pnpm exec vitest run
  Test Files 192 passed, 1 skipped (193)
  Tests 1,869 passed, 3 skipped (1,872)
  exit 0
```

The repair removed `packages/runtime-native/scripts/install-prebuilt.d.mts`. Both TypeScript
callers now load the executable `install-prebuilt.mjs` contract dynamically; the installed runtime
module remains the single owner of `releaseManifestUrl()`.

## Negative controls observed red before green

These were run while each phase's test or consumer was still pointing at the old/missing path:

| Phase | Red observation |
|---|---|
| 1 | Runtime distribution tests failed for the dead `jonit-dev` URL, missing `writeInstallStatus`, and missing `PREBUILT_KEYS`; doctor native-runtime cases failed before the check was wired. |
| 2 | The workflow key-table test failed while `.github/workflows/native-release.yml` had no `PREBUILT_KEYS` check. |
| 3 | Publish-state tests failed while `templatePinCensus` and `prebuiltReleaseCensus` were not exported or assembled. |
| 4 | Registry verifier tests failed while the flow still had only scaffold/install/lockfile/build/test; native, doctor, and MCP assertions had no live steps. |
| 5 | Sandbox package-list/flag tests and the short runtime override test failed before the new package table and alias were added. |

The declared status-file control was also run red-first: with the status file deleted, the temporary
expectation of a hard failure produced `expected status fail, received warn` with 12 passing and 1
failing test. The contract was corrected to report `warn / unknown — no install status recorded`,
and the final doctor suite passed 13/13. The other final negative cases pass in the changed suites:
missing native output, a timed-out MCP server, unrun steps, absent template pins, absent prebuilt
releases, a corrupted prebuilt download, and a missing runtime binary all produce failures rather
than vacuous green results.

## Final integration proof

### 1. Dead release-host search

Command:

```bash
grep -rn "jonit-dev" packages scripts .github --include='*.mjs' --include='*.ts' --include='*.yml'
```

Output:

```text
packages/runtime-native/scripts/physical-device-evidence.mjs:476:      remote: "https://github.com/jonit-dev/threenative.git",
.github/ISSUE_TEMPLATE/config.yml:4:    url: https://github.com/jonit-dev/threenative/discussions
```

Those two references are outside the PRD phase file set and were not edited in this lane.

### 2. New-symbol caller census

Command:

```bash
grep -rn "writeInstallStatus\|templatePinCensus\|prebuiltReleaseCensus\|RELEASE_REPOSITORY" \
  packages scripts --include='*.ts' --include='*.mjs' | grep -v "__tests__" | grep -v ".spec."
```

Output:

```text
packages/runtime-native/scripts/install-prebuilt.mjs:10:export const RELEASE_REPOSITORY = 'ThreeNativeHQ/threenative';
packages/runtime-native/scripts/install-prebuilt.mjs:72:  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/runtime-native-v${encodeURIComponent(version)}/prebuilt-lock.json`;
packages/runtime-native/scripts/install-prebuilt.mjs:75:export function writeInstallStatus(status, statusPath = join(packageRoot, 'prebuilt', 'install-status.json')) {
packages/runtime-native/scripts/install-prebuilt.mjs:143:      .then(() => writeInstallStatus({ key, ok: true, reason: 'installed', url, version: packageVersion }))
packages/runtime-native/scripts/install-prebuilt.mjs:147:          writeInstallStatus({ key, ok: false, reason, url, version: packageVersion });
packages/runtime-native/tests/distribution.test.mjs:13:  RELEASE_REPOSITORY,
packages/runtime-native/tests/distribution.test.mjs:20:  writeInstallStatus,
packages/runtime-native/tests/distribution.test.mjs:76:  assert.equal(RELEASE_REPOSITORY, 'ThreeNativeHQ/threenative');
packages/runtime-native/tests/distribution.test.mjs:85:  writeInstallStatus(
scripts/check-publish-state.ts:171:export function templatePinCensus(
scripts/check-publish-state.ts:251:export function prebuiltReleaseCensus(
scripts/check-publish-state.ts:484:  findings.push(...templatePinCensus(repo, lookup));
scripts/check-publish-state.ts:485:  findings.push(...prebuiltReleaseCensus(repo, options.prebuiltProbe));
```

The non-test consumers are the installer CLI branch and release URL builder, and the
`checkPublishState` report assembly.

### 3. Real registry clean-room command

Command:

```bash
pnpm tsx scripts/verify-registry-install.ts
```

Output:

```text
pass  scaffold
FAIL  install
      npm error code EUNSUPPORTEDPROTOCOL
      npm error Unsupported URL Type "workspace:": workspace:*
FAIL  lockfile
      Not run: the install step failed to produce an installed project.
FAIL  build
      Not run: the install step failed to produce an installed project.
FAIL  test
      Not run: the install step failed to produce an installed project.
FAIL  doctor
      Not run: the install step failed to produce an installed project.
FAIL  native
      Not run: the install step failed to produce an installed project.
FAIL  mcp
      Not run: the install step failed to produce an installed project.
The registry install path is broken. This is alpha row A1.
```

The scaffold reached the registry, but the currently published package still contains
`workspace:*`; the fail-closed step list is the expected diagnostic.

### 4. Prebuilt release probe

Command:

```bash
curl -sI "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v$(node -p \
  "require('./packages/runtime-native/package.json').version")/prebuilt-lock.json" | head -1
```

Output:

```text
HTTP/2 404
```

No release URL or asset SHA-256 is claimed until the external `runtime-native-v0.3.0` release is
created.

## Repair round 2 — final read-only review defects

Status: **IMPLEMENTATION VERIFIED; external release checkpoint remains UNVERIFIED**

### Installed desktop verifier: observed red before repair

After bootstrapping the fresh worktree with `pnpm install --frozen-lockfile`, the installed-package
regression failed before the fake starter executable could start:

```bash
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/distribution.test.mjs -t "an installed runtime verifier uses packaged Linux display support"
```

```text
FAIL tests/distribution.test.mjs > an installed runtime verifier uses packaged Linux display support
Error: Command failed: /home/joao/.nvm/versions/node/v20.19.6/bin/node /tmp/threenative-installed-verifier-FQ1mBU/consumer/node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs
TN_NATIVE_STARTER_EXIT_127:

sh: /tmp/threenative-installed-verifier-FQ1mBU/consumer/node_modules/scripts/xvfb.sh: No such file or directory

Tests 1 failed, 16 skipped; exit 1
```

The repair packages `packages/runtime-native/scripts/xvfb.sh`, resolves it beside the installed
verifier, and preserves the wrapped command's exit status. The regression installs the packed
runtime into a temporary consumer project, invokes the installed verifier, and separately observes
the packaged helper returning exit status 7.

### Consumer test command: observed red before repair

```bash
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts \
  -t "runs the consumer test command through pnpm"
```

```text
FAIL scripts/__tests__/verify-registry-install.spec.ts > pnpm tsx scripts/verify-registry-install.ts > runs the consumer test command through pnpm
AssertionError: expected [ [ 'npm', 'test' ] ] to deeply equal [ [ 'pnpm', 'test' ] ]

Tests 1 failed, 11 skipped; exit 1
```

The verifier now invokes `pnpm test`; the regression records the consumer command and remains
fail-closed for failed steps.

### Green repair verification

```text
installed runtime regression: 1 passed, 16 skipped; exit 0
consumer command regression: 1 passed, 11 skipped; exit 0
runtime distribution + starter suites: 2 files passed; 21 tests passed
registry verifier suite: 1 file passed; 12 tests passed
packaged xvfb status probe: helper_exit=7
```

The status probe also emitted existing Xvfb/xkbcomp warnings; they were non-fatal, and the wrapped
exit status remained 7. No `xvfb-run` was introduced.

The repository gates completed as follows:

```text
pnpm build       exit 0  (bootstrap required declarations and package dist)
pnpm typecheck   exit 0
pnpm lint        exit 0; 293 report-only warnings
pnpm budgets     exit 0; report-only LOC/census messages
pnpm quality     exit 0; 71 report-only findings
```

The full `pnpm test` run executed all 193 test files and 1,873 tests successfully, but the
top-level command exited 1 because the suite-wide temporary-directory guard observed:

```text
temporary directory count changed across the full test suite: before 101, after 102
```

Another lane owns a Playwright process in `test-pipeline-audit-final`; the cross-worktree orphan
guard is therefore not claimed, and no foreign process was killed.

### External clean-room result after repair

```bash
pnpm tsx scripts/verify-registry-install.ts
```

```text
pass  scaffold
FAIL  install
      Command failed: npm install
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
FAIL  lockfile
      Not run: the install step failed to produce an installed project.
FAIL  build
      Not run: the install step failed to produce an installed project.
FAIL  test
      Not run: the install step failed to produce an installed project.
FAIL  doctor
      Not run: the install step failed to produce an installed project.
FAIL  native
      Not run: the install step failed to produce an installed project.
FAIL  mcp
      Not run: the install step failed to produce an installed project.
The registry install path is broken. This is alpha row A1.
exit 1
```

The external install fails before the new `pnpm test` step can be reached because the currently
published package still contains `workspace:*`. The release probe remains:

```text
HTTP/2 404
```

No external package publication, GitHub release, Android APK, or consumer desktop render is
claimed by this repair lane.

## Repair round 2 follow-up — coordinated publish preflight

Status: **IMPLEMENTATION VERIFIED; external release checkpoint remains UNVERIFIED**

### Publish-set pin regression: observed red before the fix

The new fixture pins `@threenative/core@0.1.0`, which is the exact package/version in
`publishSet(root)`. The lookup reports that exact registry version as absent. Before the source
fix, the focused regression failed with the following assertion:

```bash
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts -t "allows an exact internal pin at the version in the current publish set"
```

```text
FAIL scripts/__tests__/check-publish-state.spec.ts > pnpm publish:check > allows an exact internal pin at the version in the current publish set
AssertionError: expected [ { …(3) } ] to deeply equal []

Expected
[]

Received
[
  {
    "detail": "templates/starter/package.json pins @threenative/core@0.1.0, but the registry has no resolvable version.",
    "package": "template:starter",
    "severity": "fail",
  },
]
```

The paired absent-pin control uses `@threenative/core@9.9.9`, which is not the exact version in
the publish set. A mutation that allowed every absent pin produced its required red result:

```bash
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts -t "fails when a template pins a package the registry does not have"
```

```text
FAIL scripts/__tests__/check-publish-state.spec.ts > pnpm publish:check > fails when a template pins a package the registry does not have
AssertionError: expected [] to have a length of 1 but got +0
```

The fix exempts only `facts.state === "absent"` pins whose complete `name@version` is in
`publishSet(repo)`. `present` remains passing and `unreachable` remains blocked.

### Repair tests and gates

```text
focused repair tests: 2 passed, 21 skipped; exit 0
publish-state suite: 23 passed; exit 0
pnpm typecheck: exit 0
pnpm lint: exit 0; 293 report-only warnings
pnpm budgets: exit 0; report-only LOC/census drift messages
pnpm quality: exit 0; 71 report-only findings
```

### Updated `PREBUILT_KEYS` caller census

The census command now includes `PREBUILT_KEYS` and the release workflow path; its output is
shown without suppressing the existing test references:

```bash
grep -rn "writeInstallStatus\|templatePinCensus\|prebuiltReleaseCensus\|RELEASE_REPOSITORY\|PREBUILT_KEYS" packages scripts .github --include='*.ts' --include='*.mjs' --include='*.yml' | grep -v "__tests__" | grep -v ".spec."
```

```text
packages/runtime-native/scripts/install-prebuilt.mjs:10:export const RELEASE_REPOSITORY = 'ThreeNativeHQ/threenative';
packages/runtime-native/scripts/install-prebuilt.mjs:13:export const PREBUILT_KEYS = Object.freeze([
packages/runtime-native/scripts/install-prebuilt.mjs:72:  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/runtime-native-v${encodeURIComponent(version)}/prebuilt-lock.json`;
packages/runtime-native/scripts/install-prebuilt.mjs:75:export function writeInstallStatus(status, statusPath = join(packageRoot, 'prebuilt', 'install-status.json')) {
packages/runtime-native/scripts/install-prebuilt.mjs:143:      .then(() => writeInstallStatus({ key, ok: true, reason: 'installed', url, version: packageVersion }))
packages/runtime-native/scripts/install-prebuilt.mjs:147:          writeInstallStatus({ key, ok: false, reason, url, version: packageVersion });
packages/runtime-native/tests/distribution.test.mjs:13:  PREBUILT_KEYS,
packages/runtime-native/tests/distribution.test.mjs:14:  RELEASE_REPOSITORY,
packages/runtime-native/tests/distribution.test.mjs:21:  writeInstallStatus,
packages/runtime-native/tests/distribution.test.mjs:77:  assert.equal(RELEASE_REPOSITORY, 'ThreeNativeHQ/threenative');
packages/runtime-native/tests/distribution.test.mjs:86:  writeInstallStatus(
packages/runtime-native/tests/distribution.test.mjs:106:  assert.ok(PREBUILT_KEYS.includes('linux-x64'));
packages/runtime-native/tests/distribution.test.mjs:107:  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime'));
packages/runtime-native/tests/distribution.test.mjs:108:  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime-v8'));
packages/runtime-native/tests/distribution.test.mjs:109:  assert.ok(PREBUILT_KEYS.includes('ios-simulator-arm64'));
packages/runtime-native/tests/distribution.test.mjs:117:  assert.match(workflow, /PREBUILT_KEYS/u);
packages/runtime-native/tests/distribution.test.mjs:121:  assert.deepEqual([...workflowKeys].sort(), [...PREBUILT_KEYS].sort());
scripts/check-publish-state.ts:175:export function templatePinCensus(
scripts/check-publish-state.ts:259:export function prebuiltReleaseCensus(
scripts/check-publish-state.ts:492:  findings.push(...templatePinCensus(repo, lookup));
scripts/check-publish-state.ts:493:  findings.push(...prebuiltReleaseCensus(repo, options.prebuiltProbe));
.github/workflows/native-release.yml:264:          RELEASE_REPOSITORY: ${{ github.repository }}
.github/workflows/native-release.yml:270:          import { PREBUILT_KEYS, RELEASE_REPOSITORY } from "./packages/runtime-native/scripts/install-prebuilt.mjs";
.github/workflows/native-release.yml:271:          if (process.env.RELEASE_REPOSITORY !== RELEASE_REPOSITORY) {
.github/workflows/native-release.yml:272:            throw new Error(`Prebuilt releases must be published by ${RELEASE_REPOSITORY}, received ${process.env.RELEASE_REPOSITORY}.`);
.github/workflows/native-release.yml:293:          const expectedKeys = [...PREBUILT_KEYS].sort();
.github/workflows/native-release.yml:305:            url: `https://github.com/${process.env.RELEASE_REPOSITORY}/releases/download/${process.env.RELEASE_TAG}/${name}`,
```

The non-test export is `packages/runtime-native/scripts/install-prebuilt.mjs:13`; the live release
workflow consumer is `.github/workflows/native-release.yml:270`, with the key-table assertion at
line 293.

### External results preserved after repair

```bash
pnpm publish:check
```

```text
Checked 8 package(s): @threenative/assets, @threenative/core, @threenative/physics, @threenative/playtest, @threenative/runtime-native, @threenative/ui, create-threenative, threenative-engine-mcp
FAIL  @threenative/runtime-native: No prebuilt release exists at https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json; publish runtime-native-v0.3.0 before publishing the runtime package.
1 finding(s). This tree must not be published as it stands.
exit 1
```

```bash
pnpm tsx scripts/verify-registry-install.ts
```

```text
pass  scaffold
Created starter project at /tmp/threenative-clean-room-nehsQl/my-game
FAIL  install
      Command failed: npm install
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
FAIL  lockfile
      Not run: the install step failed to produce an installed project.
FAIL  build
      Not run: the install step failed to produce an installed project.
FAIL  test
      Not run: the install step failed to produce an installed project.
FAIL  doctor
      Not run: the install step failed to produce an installed project.
FAIL  native
      Not run: the install step failed to produce an installed project.
FAIL  mcp
      Not run: the install step failed to produce an installed project.
The registry install path is broken. This is alpha row A1.
exit 1
```

```bash
curl -sI "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v$(node -p "require('./packages/runtime-native/package.json').version")/prebuilt-lock.json" | head -1
```

```text
HTTP/2 404
```

No package publication, GitHub release, Android APK, or consumer desktop render is claimed by
this repair lane.

## Repair round 3 — contract-preserving lane

Status: **IMPLEMENTATION VERIFIED; external registry/release gates remain UNVERIFIED**

This round repaired the two blocking review defects without changing the published-release
evidence. The default publish preflight is fail-closed again. The release workflow alone passes the
explicit `--allow-current-publish-set-pins` option, and that option does not suppress pins outside
the current publish set. The MCP verifier now validates every search hit against the published
engine-MCP result shape.

### Required red controls, observed before the repair

The default publish-state regression was run before changing `templatePinCensus`. It failed because
the old implementation returned no finding for an absent exact pin in the current publish set:

```bash
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts -t "rejects an absent exact internal pin at the version in the current publish set by default"
```

```text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-196-published-install-is-functional-r3

 ❯ scripts/__tests__/check-publish-state.spec.ts (26 tests | 1 failed | 25 skipped) 49ms
 × rejects an absent exact internal pin at the version in the current publish set by default 46ms
AssertionError: expected [] to deep equally contain ObjectContaining{…}
❯ scripts/__tests__/check-publish-state.spec.ts:223:45

Expected:
ObjectContaining { "package": "template:starter", "severity": "fail" }
Received:
[]

Test Files 1 failed (1)
Tests 1 failed | 25 skipped (26)
```

The MCP malformed-hit control was also run before adding contract validation. `[{}]` was accepted
because the old verifier checked only that the JSON array was non-empty:

```bash
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts -t "fails when engine MCP returns a malformed capability hit"
```

```text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/prd-196-published-install-is-functional-r3

 ❯ scripts/__tests__/verify-registry-install.spec.ts (13 tests | 1 failed | 12 skipped) 30ms
 × fails when engine MCP returns a malformed capability hit 27ms
AssertionError: expected +0 to be 1 // Object.is equality
- Expected 1
+ Received 0
❯ scripts/__tests__/verify-registry-install.spec.ts:259:29

Test Files 1 failed (1)
Tests 1 failed | 12 skipped (13)
```

### Repair tests and relevant full suites

The focused controls are green after the repair:

```text
pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts -t "current publish set|coordinated pin opt-in|workflow"
Test Files 1 passed (1)
Tests 5 passed | 21 skipped (26)

pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts -t "every step runs|malformed capability hit"
Test Files 1 passed (1)
Tests 2 passed | 11 skipped (13)

pnpm exec vitest run scripts/__tests__/check-publish-state.spec.ts
Test Files 1 passed (1)
Tests 26 passed (26)

pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts
Test Files 1 passed (1)
Tests 13 passed (13)
```

The repository-wide `pnpm test` run completed all package and unit assertions, but the suite
finalizer failed its existing temporary-directory invariant. This is the exact final result; no
test assertion failed:

```text
Test Files 193 passed (193)
     Tests 1878 passed (1878)
temporary directory count changed across the full test suite: before 113, after 114
 ELIFECYCLE  Command failed with exit code 1.
```

### Publish preflight mode proof

The default public command remains unchanged and rejects the current unpublished state. It now
reports the absent template pins instead of silently treating them as releasable:

```bash
pnpm publish:check
```

```text
Checked 8 package(s): @threenative/assets, @threenative/core, @threenative/physics, @threenative/playtest, @threenative/runtime-native, @threenative/ui, create-threenative, threenative-engine-mcp
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:action-rpg: templates/action-rpg/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:defense: templates/defense/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:minimal: templates/minimal/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:platformer: templates/platformer/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:racing: templates/racing/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:shooter: templates/shooter/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/core@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/physics@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/ui@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/assets@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/playtest@0.3.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins threenative-engine-mcp@0.2.0, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins create-threenative@0.2.3, but the registry has no resolvable version.
FAIL  template:starter: templates/starter/package.json pins @threenative/runtime-native@0.3.0, but the registry has no resolvable version.
FAIL  @threenative/runtime-native: No prebuilt release exists at https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json; publish runtime-native-v0.3.0 before publishing the runtime package.
56 finding(s). This tree must not be published as it stands.
 ELIFECYCLE  Command failed with exit code 1.
```

The explicit release-only mode is accepted by the real CLI and the workflow test asserts the exact
workflow command. It suppresses only absent exact pins in `publishSet(repo)`; the unpublished
prebuilt release still fails:

```bash
pnpm publish:check --allow-current-publish-set-pins
```

```text
Checked 8 package(s): @threenative/assets, @threenative/core, @threenative/physics, @threenative/playtest, @threenative/runtime-native, @threenative/ui, create-threenative, threenative-engine-mcp
FAIL  @threenative/runtime-native: No prebuilt release exists at https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json; publish runtime-native-v0.3.0 before publishing the runtime package.
1 finding(s). This tree must not be published as it stands.
 ELIFECYCLE  Command failed with exit code 1.
```

### Complete PRD-196 export/caller census

The following is the exact uncensored command output. Test references are intentionally present;
the non-test live callers are the `packages/`, `scripts/`, and `.github/workflows/` lines that are
not under a test path.

```bash
grep -rnE '\b(writeInstallStatus|templatePinCensus|prebuiltReleaseCensus|RELEASE_REPOSITORY|releaseManifestUrl|PREBUILT_KEYS|nativeRuntimeCheck|PACKAGES|RegistryLookup|PrebuiltReleaseProbe|McpRunner|realMcpRunner)\b' packages scripts .github --include='*.ts' --include='*.mjs' --include='*.yml'
```

```text
packages/create-threenative/src/doctor.ts:147:export function nativeRuntimeCheck(snapshot: IProjectSnapshot): IDoctorCheck {
packages/create-threenative/src/doctor.ts:323:  const nativeRuntime = nativeRuntimeCheck(snapshot);
packages/create-threenative/src/doctor.ts:394:    const releaseUrl = record(module)?.releaseManifestUrl;
packages/runtime-native/scripts/install-prebuilt.mjs:10:export const RELEASE_REPOSITORY = 'ThreeNativeHQ/threenative';
packages/runtime-native/scripts/install-prebuilt.mjs:13:export const PREBUILT_KEYS = Object.freeze([
packages/runtime-native/scripts/install-prebuilt.mjs:71:export function releaseManifestUrl(version = packageVersion) {
packages/runtime-native/scripts/install-prebuilt.mjs:72:  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/runtime-native-v${encodeURIComponent(version)}/prebuilt-lock.json`;
packages/runtime-native/scripts/install-prebuilt.mjs:75:export function writeInstallStatus(status, statusPath = join(packageRoot, 'prebuilt', 'install-status.json')) {
packages/runtime-native/scripts/install-prebuilt.mjs:106:    : await fetchRelease(options.manifestUrl ?? releaseManifestUrl(), key);
packages/runtime-native/scripts/install-prebuilt.mjs:141:    const url = process.env.THREENATIVE_PREBUILT_MANIFEST ?? releaseManifestUrl();
packages/runtime-native/scripts/install-prebuilt.mjs:143:      .then(() => writeInstallStatus({ key, ok: true, reason: 'installed', url, version: packageVersion }))
packages/runtime-native/scripts/install-prebuilt.mjs:147:          writeInstallStatus({ key, ok: false, reason, url, version: packageVersion });
packages/runtime-native/scripts/package-android.mjs:17:import { downloadReleaseArtifact, releaseManifestUrl, verifyChecksum } from './install-prebuilt.mjs';
packages/runtime-native/scripts/package-android.mjs:419:    options.manifestPath ?? options.manifestUrl ?? releaseManifestUrl(options.version);
packages/runtime-native/scripts/package-android.mjs:422:    manifestUrl: options.manifestUrl ?? releaseManifestUrl(options.version),
packages/runtime-native/tests/distribution.test.mjs:13:  PREBUILT_KEYS,
packages/runtime-native/tests/distribution.test.mjs:14:  RELEASE_REPOSITORY,
packages/runtime-native/tests/distribution.test.mjs:18:  releaseManifestUrl,
packages/runtime-native/tests/distribution.test.mjs:21:  writeInstallStatus,
packages/runtime-native/tests/distribution.test.mjs:74:    releaseManifestUrl(),
packages/runtime-native/tests/distribution.test.mjs:77:    assert.equal(RELEASE_REPOSITORY, 'ThreeNativeHQ/threenative');
packages/runtime-native/tests/distribution.test.mjs:78:  assert.match(releaseManifestUrl(), /\/runtime-native-v\d+\.\d+\.\d+\//u);
packages/runtime-native/tests/distribution.test.mjs:84:  const url = releaseManifestUrl();
packages/runtime-native/tests/distribution.test.mjs:86:  writeInstallStatus(
packages/runtime-native/tests/distribution.test.mjs:106:  assert.ok(PREBUILT_KEYS.includes('linux-x64'));
packages/runtime-native/tests/distribution.test.mjs:107:  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime'));
packages/runtime-native/tests/distribution.test.mjs:108:  assert.ok(PREBUILT_KEYS.includes('android-arm64-v8a-runtime-v8'));
packages/runtime-native/tests/distribution.test.mjs:109:  assert.ok(PREBUILT_KEYS.includes('ios-simulator-arm64'));
packages/runtime-native/tests/distribution.test.mjs:117:  assert.match(workflow, /PREBUILT_KEYS/u);
packages/runtime-native/tests/distribution.test.mjs:121:  assert.deepEqual([...workflowKeys].sort(), [...PREBUILT_KEYS].sort());
scripts/__tests__/alpha-bar.spec.ts:18:const PACKAGES = [
scripts/__tests__/alpha-bar.spec.ts:25:  const found = PACKAGES.find((item) => item.name === packageName);
scripts/__tests__/alpha-bar.spec.ts:208:  for (const item of PACKAGES)
scripts/__tests__/check-publish-state.spec.ts:9:  type RegistryLookup,
scripts/__tests__/check-publish-state.spec.ts:12:  prebuiltReleaseCensus,
scripts/__tests__/check-publish-state.spec.ts:16:  templatePinCensus,
scripts/__tests__/check-publish-state.spec.ts:24:const PACKAGES = [
scripts/__tests__/check-publish-state.spec.ts:38:  for (const item of PACKAGES) {
scripts/__tests__/check-publish-state.spec.ts:56:  write(root, RELEASE_WORKFLOW, PACKAGES.map((item) => `#   ${item.name}`).join("\n"));
scripts/__tests__/check-publish-state.spec.ts:61:const everythingPublished: RegistryLookup = (name) => ({
scripts/__tests__/check-publish-state.spec.ts:64:  version: PACKAGES.find((item) => item.name === name)?.version ?? "0.0.0",
scripts/__tests__/check-publish-state.spec.ts:206:    const findings = templatePinCensus(root, (name, version) =>
scripts/__tests__/check-publish-state.spec.ts:218:    const lookup: RegistryLookup = (name, version) =>
scripts/__tests__/check-publish-state.spec.ts:223:    expect(templatePinCensus(root, lookup)).toContainEqual(
scripts/__tests__/check-publish-state.spec.ts:246:    const lookup: RegistryLookup = (name, version) =>
scripts/__tests__/check-publish-state.spec.ts:251:    expect(templatePinCensus(root, lookup, { allowCurrentPublishSetPins: true })).toEqual([]);
scripts/__tests__/check-publish-state.spec.ts:270:    const findings = templatePinCensus(root, () => ({ state: "absent" }), {
scripts/__tests__/check-publish-state.spec.ts:291:    expect(templatePinCensus(root, () => ({ state: "present", version: "0.1.0" }))).toEqual([]);
scripts/__tests__/check-publish-state.spec.ts:296:    const findings = prebuiltReleaseCensus(root, () => "absent", "0.3.0");
scripts/__tests__/check-publish-state.spec.ts:303:    const findings = prebuiltReleaseCensus(root, () => "unreachable", "0.3.0");
scripts/__tests__/make-sandbox.spec.ts:8:  PACKAGES,
scripts/__tests__/make-sandbox.spec.ts:34:  expect(PACKAGES).toContain("runtime-native");
scripts/__tests__/make-sandbox.spec.ts:35:  expect(PACKAGES).toContain("engine-mcp");
scripts/__tests__/verify-registry-install.spec.ts:8:  type McpRunner,
scripts/__tests__/verify-registry-install.spec.ts:88:function happyMcpRunner(): McpRunner {
scripts/check-publish-state.ts:24:const { releaseManifestUrl } = (await import(
scripts/check-publish-state.ts:26:)) as { readonly releaseManifestUrl: (version?: string) => string };
scripts/check-publish-state.ts:87:export type RegistryLookup = (packageName: string, version?: string) => IRegistryFacts;
scripts/check-publish-state.ts:89:export function npmLookup(repo: string): RegistryLookup {
scripts/check-publish-state.ts:171:export function templatePinCensus(
scripts/check-publish-state.ts:173:  lookup: RegistryLookup = npmLookup(repo),
scripts/check-publish-state.ts:224:export type PrebuiltReleaseProbe = (url: string) => "absent" | "present" | "unreachable";
scripts/check-publish-state.ts:226:function headPrebuiltRelease(url: string): ReturnType<PrebuiltReleaseProbe> {
scripts/check-publish-state.ts:261:export function prebuiltReleaseCensus(
scripts/check-publish-state.ts:263:  probe: PrebuiltReleaseProbe = headPrebuiltRelease,
scripts/check-publish-state.ts:267:  const url = releaseManifestUrl(version);
scripts/check-publish-state.ts:268:  let state: ReturnType<PrebuiltReleaseProbe>;
scripts/check-publish-state.ts:446:  readonly lookup?: RegistryLookup;
scripts/check-publish-state.ts:447:  readonly prebuiltProbe?: PrebuiltReleaseProbe;
scripts/check-publish-state.ts:496:    ...templatePinCensus(repo, lookup, {
scripts/check-publish-state.ts:500:  findings.push(...prebuiltReleaseCensus(repo, options.prebuiltProbe));
scripts/make-sandbox.ts:20:export const PACKAGES = [
scripts/make-sandbox.ts:32:type PackageTarball = (typeof PACKAGES)[number] | typeof CLI_PACKAGE;
scripts/make-sandbox.ts:297:  return ([...PACKAGES] as string[]).includes(packageName)
scripts/make-sandbox.ts:298:    ? (packageName as (typeof PACKAGES)[number])
scripts/make-sandbox.ts:476:    arm === "vanilla" ? (["playtest"] as const) : [...PACKAGES, CLI_PACKAGE];
scripts/make-sandbox.ts:479:    for (const name of [...PACKAGES, CLI_PACKAGE]) {
scripts/make-sandbox.ts:487:    const owner = [...PACKAGES].find((name) => file.startsWith(`threenative-${name}-`));
scripts/make-sandbox.ts:508:    ...PACKAGES.flatMap((name) => [`--${name}-package`, tarballs[name] as string]),
scripts/verify-registry-install.ts:75:export type McpRunner = (
scripts/verify-registry-install.ts:220:export function realMcpRunner(
scripts/verify-registry-install.ts:240:  readonly mcp?: McpRunner;
scripts/verify-registry-install.ts:306:function mcpStep(project: string, runner: McpRunner): string {
scripts/verify-registry-install.ts:356:  const mcp = options.mcp ?? realMcpRunner;
.github/workflows/native-release.yml:264:          RELEASE_REPOSITORY: ${{ github.repository }}
.github/workflows/native-release.yml:270:          import { PREBUILT_KEYS, RELEASE_REPOSITORY } from "./packages/runtime-native/scripts/install-prebuilt.mjs";
.github/workflows/native-release.yml:271:          if (process.env.RELEASE_REPOSITORY !== RELEASE_REPOSITORY) {
.github/workflows/native-release.yml:272:            throw new Error(`Prebuilt releases must be published by ${RELEASE_REPOSITORY}, received ${process.env.RELEASE_REPOSITORY}.`);
.github/workflows/native-release.yml:293:          const expectedKeys = [...PREBUILT_KEYS].sort();
.github/workflows/native-release.yml:305:            url: `https://github.com/${process.env.RELEASE_REPOSITORY}/releases/download/${process.env.RELEASE_TAG}/${name}`,
```

Non-test callers from that complete output include `doctor.ts:323` for `nativeRuntimeCheck`,
`make-sandbox.ts:297,298,476,479,487,508` for `PACKAGES`, `check-publish-state.ts:89,173,446`
for `RegistryLookup`, `check-publish-state.ts:226,263,268,447` for `PrebuiltReleaseProbe`,
`verify-registry-install.ts:240,306` for `McpRunner`, `verify-registry-install.ts:356` for
`realMcpRunner`, and `native-release.yml:270,293` for `PREBUILT_KEYS`. The release symbols also
have live consumers at `package-android.mjs:17,419,422`, `install-prebuilt.mjs:106,141,143,147`
for `releaseManifestUrl` and `writeInstallStatus`, and at `check-publish-state.ts:24,267` for
`releaseManifestUrl`, and at
`native-release.yml:270-272` for `RELEASE_REPOSITORY`.

### Required integration proof after the repair

The dead-host scan still finds only unrelated existing references outside this repair's scope:

```bash
grep -rn "jonit-dev" packages scripts .github --include='*.mjs' --include='*.ts' --include='*.yml'
```

```text
packages/runtime-native/scripts/physical-device-evidence.mjs:476:      remote: "https://github.com/jonit-dev/threenative.git",
.github/ISSUE_TEMPLATE/config.yml:4:  url: https://github.com/jonit-dev/threenative/discussions
```

The registry clean-room command was rerun from this worktree and remains red at the external
published package boundary:

```bash
pnpm tsx scripts/verify-registry-install.ts
```

```text
pass  scaffold
Created starter project at /tmp/threenative-clean-room-uTpINt/my-game
FAIL  install
      Command failed: npm install
npm warn Unknown env config "verify-deps-before-run". This will stop working in the next major version of npm.
npm error code EUNSUPPORTEDPROTOCOL
npm error Unsupported URL Type "workspace:": workspace:*
npm error A complete log of this run can be found in: /tmp/threenative-clean-room-uTpINt/npm-cache/_logs/2026-08-24T03_39_33_428Z-debug-0.log

FAIL  lockfile
      Not run: the install step failed to produce an installed project.
FAIL  build
      Not run: the install step failed to produce an installed project.
FAIL  test
      Not run: the install step failed to produce an installed project.
FAIL  doctor
      Not run: the install step failed to produce an installed project.
FAIL  native
      Not run: the install step failed to produce an installed project.
FAIL  mcp
      Not run: the install step failed to produce an installed project.
The registry install path is broken. This is alpha row A1.
```

The shipped runtime release probe remains unresolved:

```bash
curl -sI "https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v$(node -p "require('./packages/runtime-native/package.json').version")/prebuilt-lock.json" | head -1
```

```text
HTTP/2 404
```

### Static gates

The fresh worktree required `pnpm install --frozen-lockfile` and `pnpm build` before typecheck;
the first typecheck attempt reported missing built workspace modules (`@threenative/playtest/*`
and `@threenative/assets`). After the prescribed build, the required gates completed as follows:

```text
pnpm typecheck: exit 0
pnpm lint: exit 0; 293 report-only complexity warnings
pnpm budgets: exit 0; budgets ok (report-only LOC/native-census drift messages)
pnpm quality: exit 0; quality report: 71 findings (12 new, 8 grew, 51 inherited, 0 waived)
pnpm exec biome check --write <four in-scope TypeScript files>: exit 0; warnings only
git diff --check: exit 0
```

No package publication, GitHub release, Android APK, consumer desktop render, or successful
external MCP call is claimed. The worktree changes for this repair are limited to the five source,
test, and workflow files plus this evidence file.
