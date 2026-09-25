import { execFile } from "node:child_process";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir";

const run = promisify(execFile);
const bundle = path.resolve("packages/create-threenative/template-assets/clearwater");
it("installs source and license, then refuses to overwrite an edited game", async () => {
  const target = await makeTempDir("clearwater-install-");
  try {
    await run(process.execPath, [path.join(bundle, "install.mjs"), target]);
    expect(await readFile(path.join(target, "src/clearwater.ts"), "utf8")).toContain(
      "createClearwater",
    );
    expect(
      await readFile(path.join(target, "src/render/CLEARWATER-LICENSE.txt"), "utf8"),
    ).toContain("Copyright (c) 2026 Lumaris");
    await writeFile(path.join(target, "src/clearwater.ts"), "// game-owned edits\n");
    await expect(run(process.execPath, [path.join(bundle, "install.mjs"), target])).rejects.toThrow(
      "Refusing to overwrite",
    );
    expect(await readFile(path.join(target, "src/clearwater.ts"), "utf8")).toBe(
      "// game-owned edits\n",
    );
    expect(await readdir(path.join(target, "src/render"))).toContain("clearwaterCaustics.ts");
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});
