import { describe, expect, it } from "vitest";
import { EVIDENCE_REF } from "../src/content/benchmarks.js";
import { docsPages } from "../src/content/docs.js";
import { prerenderedPage } from "./support.js";

describe("prerendered documentation evidence", () => {
  it("keeps all five comparison columns in the initial HTML", async () => {
    const page = await prerenderedPage("/docs/comparison");
    for (const name of ["ThreeNative", "Three.js", "Godot", "Unity", "Unreal Engine"]) {
      expect(page).toContain(`scope="col">${name}</th>`);
    }
    expect(page).toContain("GDExtension");
    expect(page).toContain('href="/docs/benchmarks"');
  });
  it("publishes the failed gates alongside reductions with immutable evidence links", async () => {
    const page = await prerenderedPage("/docs/benchmarks");
    for (const text of ["Tint uniforms", "Tint + stable names", "16,500.797697", "8,000", "AC-charging", "Not measured", "VOID", "Partial qualification"]) {
      expect(page).toContain(text);
    }
    expect(page).toContain(`/blob/${EVIDENCE_REF}/docs/benchmark/LOC.md`);
    expect(page).not.toContain("/blob/main/docs/");
    expect(page).toContain("not a fresh benchmark");
  });
  it("keeps edit links and native mobile navigation available on every guide", async () => {
    for (const doc of docsPages) {
      const page = await prerenderedPage(doc.path);
      expect(page).toContain(`/edit/develop/${doc.sourceFile}`);
      expect(page).toContain('data-testid="mobile-docs-navigation"');
      expect(page).toContain('id="docs-content"');
    }
  });
});
