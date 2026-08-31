// The model pass writes Meshopt-compressed output and then re-reads it to self-verify. Reading it
// needs the Meshopt decoder's WebAssembly module, which instantiates asynchronously after import —
// so a process whose first model reaches the pass before that instantiation settles gets
// "Cannot read properties of undefined (reading 'exports')" wrapped in TN_ASSETS_MODEL_UNREADABLE,
// on a file that is perfectly well formed. Found baking `examples/quarry`, whose first model is
// the first thing that process does and carries no embedded texture to encode on the way.
//
// This runs in a child process on purpose. The race only exists in the first milliseconds after
// the codec is imported, and by the time any in-process spec reaches it, every earlier spec in the
// worker has already awaited the decoder on its behalf.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("model pass decoder readiness", () => {
  it("should self-verify its own output on the first model of a fresh process", () => {
    const directory = makeTempDirSync("tn-model-pass-race-");
    const script = join(directory, "first-model.mts");
    writeFileSync(
      script,
      [
        `import { modelPass } from ${JSON.stringify(join(repositoryRoot, "packages/assets/src/passes/model.ts"))};`,
        `import { buildFixtureGlb } from ${JSON.stringify(join(repositoryRoot, "test-support/generate-fixture-model.ts"))};`,
        // Untextured on purpose: encoding an embedded image is a long async detour that lets the
        // decoder settle behind the pass's back, which is why a textured model never sees this.
        "const input = Buffer.from(await buildFixtureGlb({ textured: false }));",
        'const result = await modelPass({ textures: "none" }).apply(input, "first-model.glb");',
        'if (Buffer.isBuffer(result)) throw new Error("model pass returned an unchanged buffer");',
        'process.stdout.write("verified");',
      ].join("\n"),
    );

    const output = execFileSync(
      process.execPath,
      [join(repositoryRoot, "node_modules/tsx/dist/cli.mjs"), script],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(output).toContain("verified");
  }, 60_000);
});
