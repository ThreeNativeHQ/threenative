import { describe, expect, it } from "vitest";
import { docPageForPath, docsNeighbours, docsPages, searchDocs } from "../src/content/docs.js";
import { primaryNav } from "../src/content/nav.js";

describe("documentation discovery", () => {
  it("normalizes the trailing slash accepted by the route table", () => {
    expect(docPageForPath("/docs/physics/")?.path).toBe("/docs/physics");
    expect(docsNeighbours("/docs/physics/")).toEqual(docsNeighbours("/docs/physics"));
    expect(docPageForPath("/docs/not-a-page")).toBeUndefined();
    expect(docsNeighbours("/docs/not-a-page")).toEqual({});
  });

  it("finds engines and topics without leaving the documentation", () => {
    expect(searchDocs("  UNREAL engine ")[0]?.path).toBe("/docs/comparison");
    expect(searchDocs("physics")[0]?.path).toBe("/docs/physics");
    expect(searchDocs("android")[0]?.path).toBe("/docs/native-runtime");
    expect(searchDocs("shader census")[0]?.path).toBe("/docs/benchmarks");
    expect(searchDocs("unreal physics unicorn")).toEqual([]);
  });

  it("returns deterministic results without reordering the registry", () => {
    const before = docsPages.map((page) => page.path);
    expect(searchDocs("   ")).toEqual(docsPages);
    expect(searchDocs("game")).toEqual(searchDocs("game"));
    expect(docsPages.map((page) => page.path)).toEqual(before);
  });

  it("keeps comparisons and benchmarks out of the top-level navbar", () => {
    expect(primaryNav.map((entry) => entry.label)).toEqual(["Product", "Docs", "Community"]);
    expect(primaryNav.find((entry) => entry.label === "Docs")?.target).toEqual({
      kind: "internal", path: "/docs",
    });
  });

  it("provides an explicit source file for every edit link", () => {
    expect(new Set(docsPages.map((page) => page.sourceFile)).size).toBe(docsPages.length);
    for (const page of docsPages) {
      expect(page.sourceFile).toMatch(/^site\/src\/components\/docs\/[A-Z][A-Za-z]+\.tsx$/u);
    }
  });
});
