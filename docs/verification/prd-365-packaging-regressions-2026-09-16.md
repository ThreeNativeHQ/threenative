# PRD-365: packaging regression corrections, 2026-09-16

Status: bounded corrections verified locally; hosted verification and full PRD acceptance remain pending.

## Candidate and scope

Tested production inputs came from PR #266 at `fd8e99cccc5ecb4092da4c66671762dcdd17b432`.
The delivery also preserves its subsequent workflow-only `f4b9d1310728bc3c4c7839aa2cb0d911491ad495`
commit, which adds the Windows SDK signtool directory to PATH. That concurrent correction is not
credited to this change. No workflow, C++ production source, signing policy or coverage floor is
weakened here.

The original packager blob was `ea994050dcf3c8c919d960d5e8e799c05fe562d8`; the original runtime
package manifest was `3d383e05d43a1d4028596f9e0f8db586921da6b3`.

## Executable-relative native bundle discovery

`external-bundle-discovery.test.mjs` compiles the actual C++ embedded-bundle loader into a small
probe, copies that executable into independent temporary app layouts, and observes each case in a
fresh process. This avoids the loader singleton masking a later lookup. The probe validates both
the entry point and an actual payload read. It does not reimplement discovery in JavaScript.

Nine cases cover a bare host, adjacent game.bundle, relocation through paths containing spaces,
a corrupt sidecar, a valid environment override, missing/corrupt override fallback, macOS Resources
lookup and its priority, and rejection of a valid bundle planted in an unrelated working directory.
The Resources expectations are platform-specific; Linux passing those cases does not prove macOS.

Observed on Linux x64: 9 passed, 0 failed. Removing the production adjacent-sidecar search made
4 fail and 5 pass; restoring the exact original source returned 9 passed. A second build using
Clang AddressSanitizer and UndefinedBehaviorSanitizer, with leak detection, passed all 9 cases.
The C++ source was restored and is not changed by this delivery.

The existing `native:verify:desktop` script now runs this same suite after its existing checks,
so the macOS and Windows desktop lanes exercise real compiled discovery rather than accepting the
Linux result as cross-platform evidence. The existing runtime-native test suite discovers it too.
There is no new CTest target and no coverage-result restamp.

## Packager finalization

The Windows PNG-to-ICO scratch directory previously survived both successful resource editing and
error exits. A try/finally now removes only the packager-owned directory, including when conversion
or rcedit throws. Caller-owned PNG/ICO input is not removed. Four resource-editor outcomes and an
authored-ICO preservation case cover that ownership boundary.

The macOS helper initially verifies the signature before writing its container manifest. A new
final `codesign --verify --strict --deep` checks the staged app after the manifest write and before
archiving or notarization. Failure is explicit (`TN_DESKTOP_CODESIGN_FINAL_VERIFY_FAILED`) and
leaves an existing destination archive untouched. Unsigned macOS preparation remains available.

This is a fail-closed correction, NOT a completed solution for the signed-container manifest cycle.
The current sign-then-manifest ordering can invalidate the resource seal. The new check refuses
that invalid result instead of publishing it as signed; a valid signed/notarized release still
needs the manifest/signing design and real platform verification. No acceptance box is checked
on the strength of this guard.

`desktop-finalization.test.mjs` exercises actual filesystem staging and real ZIP creation. Signing
and resource-editor commands use the existing injected transport; the signature fixture compares
the files before and after signing rather than simply returning success for every command. It is
not a real codesign/signtool execution. Replacing the corrected packager with the original produced
6 failures and 2 passes; restoring the correction produced 8 passes and no failures. The two
macOS rejection cases cover both a new output and preservation of a previous archive.

## Verification boundaries and reproduction

The working environment had Node 22, CMake and native compilers, but no pnpm/Vitest installation
or outbound package access. The repository test bodies were executed using Node's test runner,
with a small import adapter only for Vitest's test/hooks and the temporary-directory registration
helper. Production imports, the C++ compiler/loader, process launches, and filesystem/archive
operations were unchanged. These are bounded local results, NOT a claim that unmodified Vitest,
full workspace gates, Windows, or macOS ran locally.

Final combined local run: 17 passed, 0 failed, 0 skipped. JavaScript syntax checks passed for the
packager and both new suites. The real hosted commands to run from a complete checkout are:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/external-bundle-discovery.test.mjs tests/desktop-finalization.test.mjs
pnpm --filter @threenative/runtime-native native:verify:desktop
```

Full current-head CI, the original desktop distribution/container suites, the new cross-platform
probe, independent review, and real credentialed signing/notarization remain required before
claiming their corresponding acceptance gates. PRD-365 remains PARTIAL.
