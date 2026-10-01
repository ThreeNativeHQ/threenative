# Strata source provenance

João supplied `strata-terrain.html` and `AGENT_GUIDE.md` and explicitly confirmed
on 2026-09-30: “I own it; use MIT.” The recovered modules and their integration
are distributed under the accompanying MIT license. The supplied files contained
no earlier copyright/license notice; no upstream license or attribution is invented.

Source SHA-256:

- `strata-terrain.html`: `c0230e6891db829a5196d93ff7c9d714a8f2d964cac4722eb8ce4b2f723d794b`.
- `AGENT_GUIDE.md`: `487453218f870c5e829d58aea3fe9323e74ea93e0aecef8d5c329ecf56972d06`.

Recovery used the HTML's named `sources` module map, rather than its duplicated
worker blob or minified viewer. The algorithms, validation and transactions are
maintained as TypeScript source. Viewer appearance/renderer code is excluded;
baking takes optional caller-owned colours and exports no chosen material.
