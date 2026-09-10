# PRD-262 phase 1 — candidate manifest and atomic install mechanics

**Date:** 2026-09-09 (task date, America/Vancouver).
**Status:** Local mechanics verified; **phase readiness BLOCKED**, independent review **PENDING**. Phase 2 has not started. This is not a public-release or native-platform acceptance record.

PRD: [matching public native runtime artifacts](../PRDs/production-readiness/PRD-262-the-runtime-native-prebuilt-release-exists.md), requested at `7d730126fe38970fd5beda0a0e7ff1f6c72664e9`.
Implementation base: `6972d87c1881a021afb041f44d4fcddcb469e971`.

## Scope and wiring

Engine distribution layer, not game code. Five files in this phase: the existing release workflow, installer, distribution tests, the iOS packaging contract test, and this record. No package version bump, release tag, npm publication, public promotion, or application migration was performed.

| Existing caller | Change and retained contract |
| --- | --- |
| `.github/workflows/native-release.yml:381` | Existing checksum-generation step delegates to `generateReleaseManifest`; candidate SHA comes from the existing exact-SHA validation output at line 385. All other jobs and release/promotion conditions are unchanged. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:108` | Generator requires the exact 17-file release matrix, including the existing iOS artifact; rejects missing, extra, or empty payloads; emits schema, package version, full source SHA, byte lengths, SHA-256 values and version-qualified URLs. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:71` | Shared manifest validation requires all 16 non-iOS inputs before a consumer selects one. It validates supplied iOS entries too, without making iOS a prerequisite for non-iOS installation. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:161` | Remote lock loading always validates the candidate envelope. A remote artifact-only lock cannot silently downgrade validation. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:130` | Explicit local artifact-only legacy pins remain readable. A partial modern envelope is not treated as a legacy pin. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:213` | Installation invalidates the old binary and success marker, writes verified bytes through a temporary sibling and rename, and publishes success last. Failure removes executable/temporary state and records failure. The CLI delegates status handling instead of writing a second result. |
| `packages/runtime-native/tests/ios-packaging.test.mjs:378` | The existing release-lane consumer contract now asserts the shared checksum generator and exact candidate-SHA binding used by the workflow. |

The advertised matrix is unchanged: Linux x64, macOS arm64, Windows x64; Android arm64-v8a and x86_64 with separate QuickJS/V8 runtime binaries, SDL, V8 libraries, shared STL, per-ABI snapshots, and the SDL AAR. iOS build, consumer, promotion and cleanup gates were retained byte-for-byte outside the checksum step.

## Executed mechanics and negative controls

Environment: Linux x64, Node `v22.16.0`. This was a **sparse, connector-retrieved test fixture**, not a full engine checkout or an installed registry consumer. The three original files were reconstructed and their Git blob hashes matched the repository before edits. The local package-version fixture was `0.3.1`, matching the fetched package manifest; no package tarball or npm integrity was produced.

HTTP downloads were served on loopback. All payloads and source SHA values used by these tests are synthetic (`1` or `2` repeated 40 times), not native build outputs. No GPU adapter, rendered session, Android device, or native gameplay was exercised.

| Command/control | Exit | Observed result |
| --- | --- | --- |
| Initial nine new installer/generator tests against the original installer | 1 | 1 passed, 8 failed: incomplete candidates accepted, old executables retained after failure, no committed success status, and no shared generator. |
| Actual publication step with the original workflow | 1 | The emitted lock had no version identity (`undefined`, expected `0.3.1`). No release command was executed. |
| `node --test packages/runtime-native/tests/prd262.node.test.mjs` | 0 | 20 selected tests passed; 140 real assertion calls. Includes nine existing installer tests and eleven added tests. |
| Revert installer and workflow to their exact original blobs; rerun the same 20-test harness | 1 | 9 passed, 11 failed; 41 assertion calls reached. |
| Restore both implementations and rerun the same harness | 0 | 20 passed, 0 failed, 0 skipped; 140 assertion calls. |
| `node --check packages/runtime-native/scripts/install-prebuilt.mjs` | 0 | Syntax accepted. |
| `node --check packages/runtime-native/tests/distribution.test.mjs` | 0 | Syntax accepted. |
| Parse both workflows and compare their structures | 0 | All nine non-publish jobs unchanged; only the existing checksum-generation step changed. Triggers, exact-SHA guards, iOS and release side effects retained. |
| `git diff --check` | 0 | No whitespace errors. |

The publication-step test extracts and executes the **actual inline Node script from the workflow**, with the shipped installer copied into a disposable directory. It generates all 17 fixture outputs, verifies the emitted identity, deletes one ABI snapshot, observes exit 1 and no manifest, restores the snapshot, and reruns green. A separate generator control rejects an empty snapshot. Download controls tamper a checksum and interrupt a transfer; neither can leave the previously installed executable or an `ok: true` marker. Remote tests reject a missing ABI snapshot before any payload request.

An additional red/green control verifies encoded release versions such as `0.3.1-rc.1+build.262`: generation must use the same URL construction as the installer.

The Node harness uses the committed test bodies, the existing loopback fixture helper, Node's real assertion functions, and the real installer. Only test-runner/temp-directory setup is adapted. It does **not** stand in for Vitest, Android packager tests, pnpm lifecycle/tarball tests, or native platform verification. The updated remote-bootstrap fixture exercises a complete modern envelope; existing explicit-pin fixtures and packed-consumer tests remain in the distribution suite.

Selected retained output:

```text
REVERT_EXIT=1
# tests 20
# pass 9
# fail 11
# ASSERTION_CALLS=41

RESTORED_EXIT=0
# tests 20
# pass 20
# fail 0
# skipped 0
# ASSERTION_CALLS=140
```

### Reproduce the local-only test selection

Run at the repository root with Python 3 and Node 22. This creates an untracked temporary test harness; it does not modify the installer or the committed distribution suite.

```sh
python3 - <<'PY'
from pathlib import Path
root = Path.cwd()
src = (root/'packages/runtime-native/tests/distribution.test.mjs').read_text()
header = '''// LOCAL ONLY: selected unmodified test bodies, real installer, Node test runner.
// Does not run Vitest, Android packaging, PNG, or pnpm packed-consumer tests.
import strictAssert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { after, afterEach, test } from 'node:test';
import { PREBUILT_KEYS, PREBUILT_ASSET_NAMES, RELEASE_REPOSITORY, platformKey, verifyChecksum,
  downloadReleaseArtifact, installPrebuilt, readRelease, releaseManifestUrl,
  sha256, writeInstallStatus } from '../scripts/install-prebuilt.mjs';
let assertions = 0;
const assert = new Proxy(strictAssert, { get(target, property) {
  const value = Reflect.get(target, property);
  return typeof value === 'function' ? (...args) => { assertions++; return Reflect.apply(value, target, args); } : value;
} });
after(() => console.log(`ASSERTION_CALLS=${assertions}`));
const roots = [];
const run = promisify(execFile);
const makeTempDirSync = (prefix) => mkdtempSync(join(tmpdir(), prefix));
afterEach(() => {
  delete process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
'''
fixture = src[src.index('/** Serves a set of named payloads'):src.index('const roots = [];')]
original = src[src.index("test('unsupported platforms"):src.index("test('Android QuickJS prebuilts")]
added = src[src.index('// PRD-262: exercise'):]
(root/'packages/runtime-native/tests/prd262.node.test.mjs').write_text(header + fixture + original + added)
PY
node --test packages/runtime-native/tests/prd262.node.test.mjs
rm packages/runtime-native/tests/prd262.node.test.mjs
```

## Required gates not completed

Each command below was attempted. Each stopped with `bash: pnpm: command not found`, exit **127**, before its gate could start:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
pnpm publish:check
pnpm typecheck && pnpm lint && pnpm test
pnpm lint
pnpm test
pnpm budgets
pnpm native:verify:desktop
```

In the chained command, lint and test did not start; the separate attempts are listed explicitly. Full checkout provisioning also failed on `Could not resolve host: github.com`. These are local provisioning limitations, **not** evidence of failed repository CI or missing GitHub write authorization. Branch creation through the GitHub connector succeeded. Biome was not available, so its formatting/lint gate is unverified.

Fresh public-state check: the GitHub API read for `releases/tags/runtime-native-v0.3.1` returned **404** in this session. No direct public manifest or payload download was verified, no final candidate was selected, and no current hosted-build result is claimed. The old PRD observation about version `0.3.0` was not reused as evidence.

The required `engine_search_capabilities` / `engine_capability_detail` tools were not exposed here. Plugin discovery did not expose a usable engine MCP endpoint; connector code searches returned no results and GitHub REST code search returned an incomplete empty result, not a usable capability inventory. This preflight remains **unexecuted**, not a claimed empty capability inventory. The implementation reuses the PRD's named installer, asset table and workflow rather than introducing a parallel distribution subsystem.

## Source identities

| File | Original Git blob | Implemented Git blob |
| --- | --- | --- |
| `install-prebuilt.mjs` | `1b2e27e945b7982c79a4c102e065c507156a6350` | `6307a1d96d0ea2700cf42d02a2342c0dabc07d70` |
| `distribution.test.mjs` | `3934e3f052f5b349bb3c81fa4ad8e8ac561243db` | `ddcebf7ff38c89e1aa121e1f059c2b35b57b7827` |
| `native-release.yml` | `50e230776587dba1362559d7a972b0f7eddf3ec4` | `2ea53977304695fdd0d1cd44c6e6cae612c34b36` |
| `ios-packaging.test.mjs` | `26934e68f73187da2e3d207a5e9ac98cc1377e1f` | `94169024f9270b2225bcdc07a23a7d460f41249f` |

Implemented SHA-256 values, in the same order:

```text
8fcc3c85e210b06d206e258635bd725af3a15b29a9bab6f031becf063d0e4080
e111952c82076fb6e59dbfa524980e9ae23911feff4a7ab4aa6b7018c130dfdb
45b1ebb7690dd9a63d2d96c1058f273ce414ffa9715f992a6c9420c43701dd24
```

## Review checkpoint and remaining work

**Independent reviewer: PENDING. No independent PASS has been received.** Local author review is not substituted for that decision. Phase 2 is not started; its packagers and consumer matrix were not changed.

Before phase 1 can close: perform the capability preflight, run the required repository gates and affected hosted lanes, bind real PRD-078 build outputs and PRD-221 aligned Android inputs to one candidate SHA/version, and verify every public manifest URL/status/hash without credentials. PRD-060 retains publication and default-tag closure. Then obtain the PRD's independent review decision before phase 2's default-starter, all-desktop-host, SDK/JDK-only and compiler-mask controls.

No PRD acceptance box has been checked. This record supplies reproducible mechanics, not release readiness.
