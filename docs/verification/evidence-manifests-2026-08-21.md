# Evidence manifests (P2-5 phase 1) — 2026-08-21

**Status: GREEN for Phase 1, Git-only.** Every new sweep archive now leaves
`archiveSandbox` with an immutable `evidence-manifest.json` and the archiver refuses to report
success until that manifest verifies against the bytes on disk. No evidence under
`docs/benchmark/` was deleted, moved, capped or rewritten; Phase 2 (bulk provider) remains
BLOCKED pending the owner checkpoint this PRD requires.

Executed on the working tree at commit `74e5213b1716033ee49bae77b238e2f44621439e`.

## What shipped

| File | Change |
| --- | --- |
| `scripts/sweep-evidence.ts` | NEW: render + verify evidence manifests, store verifier, CLI (`render` / `verify` / `verify-store`) |
| `scripts/__tests__/sweep-evidence.spec.ts` | NEW: 21 tests — hash drift, deleted/unlisted files, malformed manifests, path traversal, duplicate identities, missing required proof, legacy handling |
| `scripts/sweep-archive.ts` | EDIT: `archiveSandbox` writes + verifies the manifest inside its existing cleanup guard; nothing else changed |
| `scripts/__tests__/sweep-archive.spec.ts` | EDIT: fixture sandbox now carries a proof result (the archiver refuses to certify without one); two new tests assert every new archive carries a verifiable manifest with proof git-retained and captures classified bulk |

## Manifest schema

```jsonc
{
  "manifestVersion": 1,
  "generator": "sweep-evidence",
  "generatorVersion": "1.0.0",
  "createdAt": "<ISO timestamp>",
  "sourceCommit": "<40-hex git sha, or null only when no checkout was available>",
  "sweep": { /* the archive's sweep.json record */ },
  "sweepIdentity": "<arm>:<genre>:<date>:<briefHash[0..12]>:<proofHash[0..12]>",
  "files": [ { "path", "sha256", "bytes", "role", "retention" } ],
  "totals": { "files", "gitFiles", "gitBytes", "bulkFiles", "bulkBytes" }
}
```

Roles classify every retained file; retention is derived from role and recorded per file.
Git-retained roles: `sweep-manifest`, `proof` (proof.json, proof-artifacts/, brief.md,
reference.png), `source` (src/), `playtest`, `baseline` (starter-baseline/, framework-types/),
`config`. Bulk-candidate roles: `capture` (screenshots/, captures/), `transcript`
(\*.jsonl.gz, \*.log), `vendor`, `media` (binary media/model/archive extensions). Classification
only labels — nothing is moved or removed in Phase 1. Proof outranks extension: a PNG under
`proof-artifacts/` is proof, not bulk.

The verifier fails closed on: hash mismatch (changed file), missing file, unlisted file
(inventory must equal the tree), missing manifest, path traversal (absolute paths, backslash
separators, NUL bytes, empty/`.`/`..` segments), duplicate file identities, an inventory that
omits `sweep.json` or `proof.json`, totals that disagree with the inventory, and any structurally
malformed manifest (bad version/generator/timestamps/hex/role/retention). The manifest never
inventories itself, so re-rendering over an existing manifest stays honest.

## Gates run

Focused specs (both green):

```text
pnpm exec vitest run --config vitest.config.ts scripts/__tests__/sweep-evidence.spec.ts \
  scripts/__tests__/sweep-archive.spec.ts
Tests  38 passed (38)
EXIT=0
```

Repository gates:

```text
pnpm typecheck   EXIT=0
pnpm lint        EXIT=0   (235 repo-wide warnings; warnings do not fail the gate.
                           One noExcessiveCognitiveComplexity warning at
                           scripts/sweep-archive.ts:113 predates this change — verified by
                           running biome check on the HEAD version of the file, which reports it
                           identically.)
```

Full `pnpm test`: **FAILED OUTSIDE THIS SCOPE, before any test executed.** It dies in
`build-capability-manifest.ts` (a file another concurrent lane owns):

```text
Capability manifest generation failed:
public exports without @situation tags: @threenative/playtest:evaluateRichPlaytestAssertions
(@threenative/playtest), @threenative/playtest:resolveDiagnosticsPolicy (@threenative/playtest)
ELIFECYCLE  Command failed with exit code 1.
```

Those exports are being refactored right now by the P2-3 lane
(`packages/playtest/src/assertions.ts` split into `assertion-schema.ts` / `assertion-evaluators.ts`
/ `assertion-report.ts`). Not fixed here per the task boundary; the lane that owns those files
must add the tags.

## Negative control 1 — manifest integrity (observed RED)

Mutation: in `verifyEvidenceManifest` the digest comparison was replaced with
`if (false && actual.sha256 !== entry.sha256)` — i.e. the line
`scripts/sweep-evidence.ts`, `if (actual.sha256 !== entry.sha256)`, disabled. Then:

```text
command: pnpm exec vitest run --config vitest.config.ts scripts/__tests__/sweep-evidence.spec.ts
exit: 1

 FAIL  scripts/__tests__/sweep-evidence.spec.ts > evidence manifests > should reject a changed archived file
Error: RED observed: evidence hash mismatch — the verifier did not reject the altered archive; it accepted it silently
 ❯ scripts/__tests__/sweep-evidence.spec.ts:188:13
    186|     }
    187|     if (!(rejection instanceof Error) || !/evidence hash mismatch/u.te…
    188|       throw new Error(
    189|         `RED observed: evidence hash mismatch — the verifier did not r…
```

(The same mutation also failed `collects a failed archive in the store report instead of
swallowing it`: expected `report.failed` 1, received 0.) Mutation reverted; suite back to
38 passed / exit 0.

## Revert check — disable manifest generation (observed RED)

Mutation: removed the `writeEvidenceManifest(destination, { repo })` +
`verifyEvidenceManifest(destination)` calls from `archiveSandbox`. Then:

```text
command: pnpm exec vitest run --config vitest.config.ts scripts/__tests__/sweep-archive.spec.ts
exit: 1

 FAIL  scripts/__tests__/sweep-archive.spec.ts > sweep archive > writes a verifiable evidence manifest into every new archive
AssertionError: promise rejected "Error: ENOENT: no such file or directory,… { …(4) }" instead of resolving
 ❯ scripts/__tests__/sweep-archive.spec.ts:335:39
    334|     const manifestPath = path.join(archive, EVIDENCE_MANIFEST_FILE);
    335|     await expect(access(manifestPath)).resolves.toBeUndefined();

Caused by: Error: ENOENT: ... access '.../fixture-2099-01-02/evidence-manifest.json'

 FAIL  scripts/__tests__/sweep-archive.spec.ts > sweep archive > classifies proof as git-retained and captures as bulk candidates without removing either
Error: ENOENT: no such file or directory, open '.../evidence-manifest.json'
```

The archived evidence has no verifiable identity, exactly the revert-check requirement.
Mutation reverted; suite back to 38 passed / exit 0.

## Dry run on real evidence (a copy — the original untouched)

Rendered a manifest for a copy of `docs/benchmark/sweeps/endless-runner-2026-08-05` in `/tmp`,
then altered one archived screenshot and ran verification:

```text
$ pnpm tsx scripts/sweep-evidence.ts render /tmp/evidence-dry-run
evidence manifest written: /tmp/evidence-dry-run/evidence-manifest.json
  sweep identity: framework:endless-runner:2026-08-05T07:06:51.190Z:21a0d1035d21:4e985122c5fd
  files: 59 (git-retained: 59 / 159141 bytes, bulk-candidate: 0 / 0 bytes)
RENDER_EXIT=0

$ pnpm tsx scripts/sweep-evidence.ts verify /tmp/evidence-dry-run
evidence verified: /tmp/evidence-dry-run
VERIFY_EXIT=0

$ printf 'tampered' >> /tmp/evidence-dry-run/proof-artifacts/0/after.png
$ pnpm tsx scripts/sweep-evidence.ts verify /tmp/evidence-dry-run
verification failed: evidence hash mismatch: 'proof-artifacts/0/after.png' manifest sha256 ace9cb2553e558c860b1555baaa74cf9515634ddf6fbc92127e6a5f880121540 != archive sha256 95fd3156126da23daf47089bd29bfb6e054608353ea438c944fa53aca3716081.
TAMPER_EXIT=1

$ cp docs/benchmark/sweeps/endless-runner-2026-08-05/proof-artifacts/0/after.png /tmp/evidence-dry-run/proof-artifacts/0/after.png
$ pnpm tsx scripts/sweep-evidence.ts verify /tmp/evidence-dry-run
evidence verified: /tmp/evidence-dry-run
RESTORE_EXIT=0
```

Verification names the altered path and refuses to report a valid archive — the PRD's user
verification action. The inventory-vs-tree comparison the PRD asks for is enforced by the
verifier itself (unlisted-file rejection).

## Old path untouched

```text
$ pnpm tsx scripts/sweep-evidence.ts verify-store docs/benchmark/sweeps
...
evidence store: 0 verified, 107 legacy (untouched), 0 failed
STORE_EXIT=0

$ find docs/benchmark/sweeps -name evidence-manifest.json | wc -l
0
$ git status --porcelain docs/benchmark/sweeps | wc -l
0
```

All 107 existing archives (~268 MB) remain readable, unmodified in git, and were not rewritten
with manifests.

## Not executed (by design)

- Phase 2 items: provider adapter, upload/download, `sweep-restore.ts`, package.json wiring,
  fake-provider tests, restore drill. The owner checkpoint naming provider, credentials source,
  retention, cost and restore owner has not happened; per this PRD's checkpoint protocol the PRD
  is BLOCKED, not green by default.
- No deletion, capping or migration of any existing evidence.
