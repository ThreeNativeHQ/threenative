import { describe, expect, it } from "vitest";
import type { RegistryLookup } from "../check-publish-state.js";
import { nextPatch, selectReleaseVersions } from "../prepare-release.js";

describe("release preparation", () => {
  it("increments only the patch component", () => {
    expect(nextPatch("0.3.0")).toBe("0.3.1");
    expect(nextPatch("1.2.9")).toBe("1.2.10");
  });

  it("keeps an entirely absent cohort idempotent", () => {
    const packages = [
      { name: "@threenative/core", version: "0.3.1" },
      { name: "create-threenative", version: "0.2.4" },
    ];
    const selected = selectReleaseVersions(packages, () => ({ state: "absent" }));

    expect([...selected.values()]).toEqual([
      { current: "0.3.1", next: "0.3.1", published: false },
      { current: "0.2.4", next: "0.2.4", published: false },
    ]);
  });

  it("bumps the entire cohort and skips occupied patch versions", () => {
    const packages = [
      { name: "@threenative/core", version: "0.3.0" },
      { name: "@threenative/ui", version: "0.3.0" },
    ];
    const occupied = new Set([
      "@threenative/core@0.3.0",
      "@threenative/core@0.3.1",
      "@threenative/ui@0.3.0",
    ]);
    const lookup: RegistryLookup = (name, version) => ({
      state: occupied.has(`${name}@${version}`) ? "present" : "absent",
    });
    const selected = selectReleaseVersions(packages, lookup);

    expect([...selected.values()]).toEqual([
      { current: "0.3.0", next: "0.3.2", published: true },
      { current: "0.3.0", next: "0.3.1", published: true },
    ]);
  });

  it("fails closed when npm cannot answer", () => {
    expect(() =>
      selectReleaseVersions([{ name: "@threenative/core", version: "0.3.0" }], () => ({
        state: "unreachable",
      })),
    ).toThrow(/TN_RELEASE_REGISTRY_UNREACHABLE/u);
  });
});
