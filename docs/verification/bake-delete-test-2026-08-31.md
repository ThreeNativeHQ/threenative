<!-- schemaVersion: 1 -->

# The delete-test is a gate, and the starter does not pass it — PRD-306, 2026-08-31

The rule every baking pass in this repository is supposed to obey — *delete the entire baked output
and the game runs identically, just slower* — now has a command. The command is red.

Base: `origin/main` at `4036f341`. Linux, Chromium through Playwright 1.62.1 under a private Xvfb,
`pnpm` 10.25.0, Node 20.19.6. Every run below is a scaffolded starter installed from locally packed
tarballs, the way a stranger's machine would get it.

## What was built

- **`bake.receipt.json`**, written by `compileAssets` on every build: every file the run produced —
  compiled outputs, auxiliary outputs, the Basis transcoder — with its producer, its source and its
  size. The producer writes it, because a consumer-side glob over `public/` would either miss an
  output or delete a source asset, and both mistakes look like a passing test. A pass that writes a
  file it did not declare now fails the build by name.
- **`pnpm bake:delete-test`**: build a template, switch off the asset watcher, run its scenario,
  delete every path the receipt names plus the manifest and the receipt, run the same scenario
  again, compare.

## The first version of this gate reported a false green

The first end-to-end run passed:

```
starter: deleted 5 baked file(s); same-code band mean |Δ| 0.264/255, unbaked run 0.290/255
  — the game runs identically without its bake
```

It was wrong, and the negative control is what caught it. Breaking **every** no-manifest exit in
`packages/core/src/assets.ts` — the 404 branch, the fetch-failed branch and the dev-server
`text/html` branch, each replaced with a throw — should have turned the gate red. It did not:

```
starter: deleted 5 baked file(s); same-code band mean |Δ| 0.291/255, unbaked run 0.290/255
  — the game runs identically without its bake
```

The reason is in the project directory afterwards. Every deleted file was back, with a timestamp
one minute later than the deletion:

```
-rw-r--r-- 1 joao joao   450 Aug 31 19:46 assets.manifest.json
-rw-r--r-- 1 joao joao   435 Aug 31 19:46 bake.receipt.json
-rw-r--r-- 1 joao joao   624 Aug 31 19:46 native-proof.76e567c1.glb
-rw-r--r-- 1 joao joao   150 Aug 31 19:46 native-proof.c70e1b5e.png
-rw-r--r-- 1 joao joao 39246 Aug 31 19:46 pickup.1fb25627.wav
```

Every template's `vite.config.ts` installs `assetsWatchPlugin()`, which calls `watchAssets` in
`configureServer`. Starting `pnpm dev` recompiles `assets/` into `public/` — so the second run's own
server restored the bake before the page loaded. **The gate deleted five files and then measured a
game that had them.** It now switches that plugin off in the project it is about to test, and
refuses to run at all if it cannot find the line to switch off, because "the watcher is off" and
"the line was not there" look identical from inside the gate and only one of them is safe.

## With the watcher off, the starter does not survive losing its bake

```
starter: deleted 5 baked file(s); same-code band mean |Δ| 0.264/255, unbaked run 0.000/255
TN_DELETE_TEST_UNBAKED_RUN_FAILED: 'starter' could not complete 'playtests/play.playtest.json'
after 5 baked file(s) were deleted. First file it asked for and did not find:
native-proof.76e567c1.glb.
```

The same project, the same watcher-disabled config, with the bake intact, passes — so the deletion
is the only difference between the two runs:

```
# bake intact, watcher off
exit=0   "pass": true

# bake deleted, watcher off
exit=2   TN_PLAYTEST_BRIDGE_MISSING — 0 frames, the page never booted
```

## Why: the fallback does not cover a compiled project

`packages/core/src/assets.ts` documents a fallback — *a manifest that is absent falls back to the
source path* — and `resolveUrl` implements it as `resolvePath(basePath, logicalPath)`. For the
starter that is `/native-proof.png`.

Nothing serves that. The sources live in `assets/native-proof.png`; the compiled outputs are
content-addressed as `native-proof.c70e1b5e.png` in `public/`. Delete the bake and the loader asks
for a URL that has never existed. The fallback is real, and it is for a different game: one with no
asset pipeline at all, whose author put the files straight into `public/` under their own names.

**So no template passes the delete-test today**, and the rule the direction document uses to
separate a baking pass from v1's IR is, as of this run, unenforced rather than satisfied.

## Disposition

- The gate ships as `pnpm bake:delete-test`. It is **not wired into CI**: a required step that is
  red blocks every pull request, and an advisory one is a gate nobody runs. It goes into the
  golden-path job in the commit that makes it pass.
- **This stop-gates PRD-307** (bake prefiltered reflections). The direction document's fifth
  falsifier says a baking pass that cannot pass the delete-test is an IR and does not ship; a second
  baking pass must not land while the first one's game cannot boot without it.
- The fix belongs in `resolveUrl`: when there is no manifest, a compiled project's logical path has
  to resolve against the configured source directory as well as the base path. That is a change to
  asset resolution on every platform — native loads through a mailbox, not a URL — so it is its own
  PRD, not a hitchhiker on this one.

## Negative controls — every one observed red

### Phase 1, the receipt

```
### 1. the auxiliary-output collection dropped
× should list every auxiliary output a pass produced
Error: TN_ASSETS_UNDECLARED_OUTPUT: this bake wrote 1 file(s) under
'/tmp/threenative-receipt-auxiliary-nm0Pn7/public' that no pass declared, so the delete-test
cannot remove them: level.lightmap.ad884b43.ktx2

### 2. the undeclared-output guard removed
× should throw when a pass writes a file under the output root it did not declare
AssertionError: promise resolved "{ receipt: { …(2) }, skipped: +0, …(1) }" instead of rejecting

### 3. a wall-clock field added to the receipt
× should still list an output the second build served from cache
× should produce an identical receipt for identical inputs

### 4. the receipt written from an empty output list
Error: TN_ASSETS_EMPTY_RECEIPT: the compile step produced no outputs for
'/tmp/threenative-receipt-basic-cf8BXI/public', so there is nothing a delete-test could remove.
```

Control 1 is the one worth reading twice: dropping the auxiliary declaration does not merely fail
the auxiliary test, it trips the undeclared-output guard *by name*, which is the defect the receipt
exists to make catchable.

### Phase 2, the gate

Fourteen unit tests cover the deletion plan, the escape guard, the empty-receipt and
empty-scenario refusals, the comparison, and the band. Each failure path is asserted as a throw or
a false verdict rather than as a skip, and the watcher-disable refuses an unknown config shape:

```
✓ should throw when the receipt is missing
✓ should throw when the receipt is empty
✓ should refuse to delete a path outside the output root
✓ should throw rather than report success when there was nothing to delete
✓ should throw when the scenario asserts nothing
✓ should pass a change inside the band and fail one beyond it
✓ should fail, naming the deleted asset, when the second run does not complete
✓ should fail when the unbaked picture moves beyond the band
✓ should refuse to measure anything when the baked run already fails
✓ should refuse to run at all when it cannot switch the asset watcher off
```

### The end-to-end negative control

Breaking `packages/core/src/assets.ts`'s no-manifest fallback and re-running the gate — the control
that is supposed to prove the gate measures the property it claims. **It did not go red**, and
chasing that is what uncovered the re-baking server above. It is recorded here as a failed control
rather than a passed one, because that is what it was.

## Not executed

- No Android, iOS, macOS or Windows run.
- `--all` was not run: seven more templates would fail the same way for the same reason, and the
  starter run already establishes it.
- Nothing here measures what baking *saves*. The receipt records sizes; no timing was taken.
