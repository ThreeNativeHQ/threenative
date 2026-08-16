import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { releaseOrder } from "../release.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function manifests(
  entries: readonly { deps?: readonly string[]; name: string }[],
): Promise<{ manifest: string; name: string }[]> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-release-order-"));
  roots.push(root);
  return entries.map((entry) => {
    const manifest = path.join(root, `${entry.name.replace("/", "-")}.json`);
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        dependencies: Object.fromEntries((entry.deps ?? []).map((dep) => [dep, "0.2.0"])),
        name: entry.name,
      }),
    );
    return { manifest, name: entry.name };
  });
}

describe("pnpm release ordering", () => {
  it("publishes the scaffolder before the package that depends on it", async () => {
    // The instinct was "scaffolder last, its templates pin everything". It cannot be last:
    // @threenative/studio depends on create-threenative. Dependency order is the only rule that
    // is always satisfiable, and this asserts the case that disproved the simpler one.
    const order = releaseOrder(
      await manifests([
        { deps: ["create-threenative"], name: "@threenative/studio" },
        { name: "create-threenative" },
        { deps: ["@threenative/core"], name: "@threenative/physics" },
        { name: "@threenative/core" },
      ]),
    );

    expect(order.indexOf("create-threenative")).toBeLessThan(order.indexOf("@threenative/studio"));
  });

  it("publishes a package after the workspace packages it depends on", async () => {
    const order = releaseOrder(
      await manifests([
        { deps: ["@threenative/core"], name: "@threenative/ui" },
        { deps: ["@threenative/core"], name: "@threenative/physics" },
        { name: "@threenative/core" },
        { name: "create-threenative" },
      ]),
    );

    expect(order.indexOf("@threenative/core")).toBeLessThan(order.indexOf("@threenative/ui"));
    expect(order.indexOf("@threenative/core")).toBeLessThan(order.indexOf("@threenative/physics"));
    expect(order).toHaveLength(4);
  });

  it("refuses a dependency cycle rather than picking an arbitrary order", async () => {
    // Publishing in an order that cannot be right is worse than refusing: the failure would
    // surface as an unreproducible install days later.
    await expect(
      manifests([
        { deps: ["@threenative/b"], name: "@threenative/a" },
        { deps: ["@threenative/a"], name: "@threenative/b" },
      ]).then(releaseOrder),
    ).rejects.toThrow(/TN_RELEASE_DEPENDENCY_CYCLE/u);
  });

  it("orders every real workspace package in dependency order", async () => {
    const { publishSet } = await import("../check-publish-state.js");
    const repo = path.resolve(import.meta.dirname, "../..");
    const order = releaseOrder(publishSet(repo));

    expect(order.indexOf("@threenative/core")).toBeLessThan(order.indexOf("@threenative/physics"));
    expect(order.indexOf("create-threenative")).toBeLessThan(order.indexOf("@threenative/studio"));
    expect(new Set(order).size).toBe(order.length);
    expect(order).toHaveLength(publishSet(repo).length);
  });
});
