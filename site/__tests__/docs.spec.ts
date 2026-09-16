import { describe, expect, it } from "vitest";
import { prerenderedPage } from "./support.js";

describe("public documentation", () => {
  it("should compare the five engine choices without hiding the alternatives", async () => {
    const page = await prerenderedPage("/docs/comparison");
    for (const name of ["ThreeNative", "Three.js", "Godot", "Unity", "Unreal Engine"]) {
      expect(page, `${name} is missing from the comparison`).toContain(name);
    }
  });

  it("should publish benchmark evidence and keep the incomplete head-to-head visibly void", async () => {
    const page = await prerenderedPage("/docs/benchmarks");
    expect(page).toContain("VOID");
    expect(page).toContain("441");
    expect(page).toContain("473");
    expect(page).toContain("74");
    expect(page).toContain("138");
    expect(page).toContain("RESULTS-2026-08-02.md");
    expect(page).toContain("LOC.md");
  });

  it("should teach the shipped core, physics, playtest and native contracts", async () => {
    const expectations = [
      ["/docs/core-concepts", ["defineGame", "fixed-step", "load", "enter", "update"]],
      ["/docs/physics", ["RigidBody3D", "Area3D", "CharacterBody3D", "CollisionShape3D", "raw"]],
      ["/docs/playtesting", ["assertions fail closed", "--target desktop", "doctor"]],
      ["/docs/native-runtime", ["portable game entry", "build:desktop", "No WebView"]],
    ] as const;

    for (const [path, terms] of expectations) {
      const page = await prerenderedPage(path);
      for (const term of terms) {
        expect(page, `${path} is missing ${term}`).toContain(term);
      }
    }
  });

  it("should expose docs discovery from the home page without adding another top-level nav item", async () => {
    const page = await prerenderedPage("/");
    expect(page).toContain('href="/docs/getting-started"');
    expect(page).toContain('href="/docs/comparison"');
    expect(page).toContain('href="/docs/benchmarks"');
  });
});
