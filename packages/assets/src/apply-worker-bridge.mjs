import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

// Plain-JS entry so the deterministic-gate's workers can load the TypeScript pass chain in
// source trees (tests, tsx). The built package never uses this file: worker-pool.ts points at
// the emitted apply-worker.js when the compile itself is compiled.
const here = dirname(fileURLToPath(import.meta.url));
register();
await import(`${pathToFileURL(here).href}/apply-worker.ts`);
