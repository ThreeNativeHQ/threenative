# tools/native-typescript

The pinned Perry compiler (`compiler.lock.json`, `provision.mjs`), the language corpus
(`run-corpus.mjs`, `corpus/`) and the Android lane. Perry is used exactly as upstream ships it
(`patches.json` is empty).

## Does a real game compile and run under Perry?

`compile-game.mjs` takes the path of a game that lives outside this repository and stages it under
the system temp directory. It never copies game source into the checkout and refuses an `--out` inside
the game or the checkout.

```sh
# Strict compile and link. Prints the unresolved imports, undefined symbols and missing three-facade
# members (missing engine API) apart from Perry's own errors. Exit 0 only when the game links.
node tools/native-typescript/compile-game.mjs <gameDir> [--entry src/game.ts]

# Perry-upgrade regression check: the game's own `check-*.mjs` assertion scripts, run under tsx and
# as Perry binaries, must print the same stdout and exit code. A reference that fails under tsx is
# reported `invalid-reference` and never counts as a pass.
node tools/native-typescript/compile-game.mjs <midway-open-pacific> \
  --checks <midway-open-pacific>/scripts \
  --package @threenative/core=packages/core/src/flight.ts
```

"Midway sim checks under Perry match tsx" is the second command on `sandbox/midway-open-pacific`.
It needs Midway checked out beside this repository, so it is not part of CI. Run it after changing
`compiler.lock.json`, and compare the `verdict` column with the previous run (28 of 32 valid scripts
were `same` on Perry 0.5.1520; each also reports `slowdown`, native time over tsx time).

`repros/` holds standalone programs for the Perry performance cliffs found this way, each with the
timings it was filed with.
