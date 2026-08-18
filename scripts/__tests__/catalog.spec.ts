import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { catalogViolations } from "../catalog";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("workspace catalog", () => {
  it("should resolve three from the catalog in every package", async () => {
    expect(await catalogViolations(process.cwd())).toEqual([]);
  });

  it("should reject a literal three version", async () => {
    const root = await makeTempDir("threenative-catalog-");
    temporaryRoots.push(root);
    await mkdir(path.join(root, "packages", "bad"), { recursive: true });
    await writeFile(
      path.join(root, "packages", "bad", "package.json"),
      JSON.stringify({ dependencies: { three: "0.185.1" } }),
    );
    expect(await catalogViolations(root)).toHaveLength(1);
  });

  it("should allow a peer range for a host-provided three dependency", async () => {
    const root = await makeTempDir("threenative-peer-");
    temporaryRoots.push(root);
    await mkdir(path.join(root, "packages", "peer-tool"), { recursive: true });
    await writeFile(
      path.join(root, "packages", "peer-tool", "package.json"),
      JSON.stringify({ peerDependencies: { three: ">=0.185.0 <0.186.0" } }),
    );
    expect(await catalogViolations(root)).toEqual([]);
  });
});
