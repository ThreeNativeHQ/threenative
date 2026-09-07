# PRD-359 owned quiche Linux producer evidence

Status: **Linux x64 producer prerequisite proven; distribution and other targets remain open.**
Recorded 2026-09-06 in `networking-359`. This record does not close the CI, platform,
pin, or full Task 1b rows.

## Inputs and source identity

The adjacent tracked builder is byte-identical to the accepted candidate:

```text
packages/runtime-native/scripts/build-quiche-owned.py
  sha256 2689a7d9235fb53797667830504ed212a597f924e7e5fa3cd7af616b75400edc
```

The test file moved beside the builder; its only differences from the candidate are
the import and command paths. Its integrated hash is
`5559acecaf1ecbeaee0eb31f681aa08829b12a8fc26a7b05098ca64d0570bea0`.
The patch files and exact builder pins are:

```text
quiche-webtransport-ffi.patch  da360ce1274173934421cd283ac6f4faddb9dbb2688b77f5a7aed284d9d2a8be
quiche-ip-san.patch             eabe59921bcd42bdd956d256e6a3628d54530a32384aa3023819811ed695b15a
upstream quiche                 020a43a0a5eed76f57dd3ce5012149aa576c594d
BoringSSL gitlink               f1c75347daa2ea81a941e953f2263e0a4d970c8d
```

`build-quiche-owned.py:96-106` checks the patch bytes. `:109-185` requires a fresh
pristine upstream HEAD, clean parent and nested submodules, actual BoringSSL HEADs,
and no ignored inputs. `:192-195` resolves patch paths before `git -C`. `:421-442`
requires `CARGO_TARGET_DIR` outside the source and applies patches only after the
pristine check. Repeat builds require a new pristine checkout; the builder does not
reset or clean caller data.

## Commands and observed results

The integrated test command was run against the adjacent tracked builder:

```text
python3 packages/runtime-native/scripts/test-build-quiche-owned.py
exit 0; Ran 32 tests; OK
```

The focused test output is `/tmp/prd359-owned-quiche-integrated-tests.log`.
`root-ignored-red.log` records the two expected failures when the ignored-input
repair was removed; it is historical mutation evidence, not a current failure.

The fresh producer command was run from an outer working directory with a new
pristine pinned checkout and external Cargo target directory:

```text
CARGO_TARGET_DIR=<outside> python3 packages/runtime-native/scripts/build-quiche-owned.py \
  linux-x64 --source-dir <pristine> --patch-dir <patches> --out <out> \
  --release-tag quiche-owned-v1 -j 4
```

`build-quiche-owned.py:434-470` is the single caller: release-tag check, source and
patch validation, cargo release build, native `ip_san` suite, symbol/header check,
archive, and manifest. `root-pristine-build.log` ends with Rust release completion,
archive/manifest paths, and `ip_san: {'status': 'passed', 'tests': 6}`. A preliminary
shallow reference clone failed while provisioning the submodule; the corrected URL
shallow clone then checked out BoringSSL at the pinned commit and the producer
completed with exit 0. This setup history is not behavior-red evidence.

## Produced artifact

`root-out/manifest-linux-x64.json` records quiche 0.24.6, the two patch digests,
`expected_tag: quiche-owned-v1`, and Rust/Cargo 1.96.0, CMake 4.4.2, Go 1.26.3.
The ZIP is DEFLATED and contains exactly `include/quiche.h` and `libquiche.a`.

```text
archive ZIP       20f9c015a1b5ec180e7106e03b892d4b0969768f6dc68480638c31800d6bb61b
manifest          f1a0946377af13a86a66ccf74f92acef2ca34e05d143b3d02bd1449b67b9f8f7
libquiche.a       89a096e3cc0aa95957a7c5d0d162684514ed5f6d5c8d957c3b3bff6b218db8e6
include/quiche.h  07d4682ff867b529b00389ea4dd33a32384ce170dc6c9e09b8677cd0f769d041
```

## Limits and next rows

No archive was installed into `third_party`, no downloader URL or checksum was
changed, and no external release was published. The execution ledger keeps
`1b-quiche-build`, CI, platform, and pin rows open (`docs/PRDs/networking/EXECUTION.md:66-69`).
Only Linux x64 was built; Windows, Apple, and Android targets remain pending. Combined repository verification subsequently completed: `pnpm test` exited 0
(root suite: 389 files passed, 4,265 tests passed, 7 skipped), and
`CMAKE_BUILD_PARALLEL_LEVEL=4 pnpm --filter @threenative/runtime-native native:coverage`
exited 0. Logs: `/tmp/prd359-quiche-win-full-test.log` and
`/tmp/prd359-quiche-win-native-coverage.log`. `pnpm typecheck`, `pnpm lint`, `pnpm census`, and `pnpm budgets` also
exited 0. Lint reported 613 existing warnings and no errors. Their logs use the
`/tmp/prd359-quiche-win-` prefix. No Windows or additional dependency target
qualification is inferred from these local gates.

The shipped engine MCP capability search and all five returned details were read
before adding these package files. None supplies a native dependency producer; the
existing native harness remains the qualification owner. Fresh read-only review
accepted the integrated Linux producer and the ignored-input repair.
