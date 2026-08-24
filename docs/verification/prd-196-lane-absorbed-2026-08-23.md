# PRD-196 lane absorbed into main (2026-08-23)

The worktree `.worktrees/prd-196-published-install-is-functional-r3`, branch
`linchpin/prd-196-published-install-is-functional-r3`, reported itself **blocked; no squash
performed** on the grounds that the prebuilt release still 404s and "main has unrelated edits".

Only the second half was actionable, and it was not a reason to hold the lane.

## Why a plain squash would have been wrong

The lane forked at `24a553c7` and was **22 commits behind main**. Its net diff against main showed
7,963 deletions, essentially all of them staleness rather than intent — files main had gained that
the branch had never seen:

| Would have been reverted | Commit |
| --- | --- |
| Android WebP texture fix, `android-webp-provisioning.test.mjs` (−92), `android-asset-preflight.test.mjs` (−172) | `62fac4d5` |
| Native `decodeAudioData` returning a real Promise, and its tests (−83, −236) | `e1908a3d` |
| GPU texture and buffer memory beside the present tick | `d6e21511` |
| QuickJS microtask pump for the frame loop | `0a5a67f8` |
| PRD-212 Phase 1 tarball gates | `439b9fd7` |
| PRD-211 Phase 2 derived WebP capability | `01ec0658` |

So the lane was **rebased**, not squash-merged from its own base. A rebase replays each commit's own
delta, which leaves main's newer files intact.

## Conflicts, and how each was resolved

Five hunks across three files. Every one was additive on both sides — no behaviour was dropped.

| File | Conflict | Resolution |
| --- | --- | --- |
| `packages/runtime-native/scripts/package-android.mjs` | lane adds `releaseManifestUrl` to the `install-prebuilt` import; main adds the `asset-preflight` import beside it | both imports kept |
| `scripts/check-publish-state.ts` | lane adds a dynamic `install-prebuilt` import; main adds `es-module-lexer` | both kept |
| `scripts/check-publish-state.ts` | lane appends `templatePinCensus` + `prebuiltReleaseCensus` to the finding assembly; main appends the tarball gates | both appended, lane's first |
| `scripts/check-publish-state.ts` | lane rewrites `main()` to take argv and a `--allow-current-publish-set-pins` flag; main had made `main()` and `checkPublishState()` async | merged: `async function main(argv)` with the flag, `await checkPublishState({ allowCurrentPublishSetPins })` |
| `scripts/__tests__/check-publish-state.spec.ts` | both sides add imports | both kept |

The lane's ten `checkPublishState(...)` call sites gained `await`, and its three new fixture-based
tests gained the `cleanTarballs` stub — its fixtures are synthetic package trees that cannot be
packed for real.

## Gates on the merged tree

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `biome check --diagnostic-level=error` | 0 diagnostics |
| `vitest run` over the lane's five specs | 103 passed |
| `vitest run --config packages/runtime-native/vitest.config.ts` | 53 files, 365 passed, 31 skipped |
| `pnpm census` | regenerated in this commit |

## One gate deliberately goes red, and it is telling the truth

`pnpm publish:check` with no flag now reports **56 findings**. That is the lane's new
`templatePinCensus` and `prebuiltReleaseCensus` working: the starter template pins
`@threenative/runtime-native@0.3.0`, `create-threenative@0.2.3` and `threenative-engine-mcp@0.2.0`,
and the registry has none of them.

With the release lane's own opt-in it reduces to the single real blocker:

```
$ npx tsx scripts/check-publish-state.ts --allow-current-publish-set-pins
Checked 8 package(s): ...
FAIL  @threenative/runtime-native: No prebuilt release exists at
      https://github.com/ThreeNativeHQ/threenative/releases/download/runtime-native-v0.3.0/prebuilt-lock.json;
      publish runtime-native-v0.3.0 before publishing the runtime package.
1 finding(s). This tree must not be published as it stands.
```

That is the lane's blocker, unchanged and now measured rather than asserted. `publish:check` is not
in the CI chain (`install → typecheck → lint → test → scaffold-smoke → visuals`), and
`npm-release.yml:46` invokes it with the opt-in, so nothing that was green has been turned red — a
tree that genuinely cannot be published now says so.

**Still owned by PRD-078**: cutting a release that survives the lane's self-deleting cleanup. Not
attempted here.

## One red investigated and attributed elsewhere

`pnpm test` failed on `packages/playtest`'s `__tests__/orphan-cleanup.sh`, which reported leftover
Chromium processes. The same script fails identically on `main` without this merge, under the same
machine load (four concurrent agent lanes). It is environmental and pre-existing, and the lane
touches nothing under `packages/playtest/`. Orphans were killed after the check; not attributed to
this change and not fixed here.
