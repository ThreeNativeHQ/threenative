import { describe, expect, it } from "vitest";
import {
  GENERATED_REGION_START,
  type IManifestEntry,
  applyRegion,
  buildSupersessionRows,
} from "../generate-ctx-surface-table.js";

const ENTRIES: readonly IManifestEntry[] = [
  {
    importPath: "@threenative/core",
    kind: "class",
    supersedes: ["new Raycaster("],
    symbol: "ScenePicker",
  },
  {
    importPath: "@threenative/core/hot",
    kind: "function",
    supersedes: [],
    symbol: "assertPortableState",
  },
  {
    importPath: "@threenative/physics/navigation",
    kind: "class",
    supersedes: ["a hand-written A*"],
    symbol: "NavigationAgent3D",
  },
];

describe("ctx-surface supersession table", () => {
  it("derives one row per enforced construct, sorted by capability", () => {
    const rows = buildSupersessionRows(ENTRIES);
    expect(rows).toContain("`new Raycaster(` | `ScenePicker` | `@threenative/core`");
    expect(rows).toContain("`a hand-written A*` | `NavigationAgent3D` |");
    expect(rows.split("\n")).toHaveLength(2);
  });

  it("replaces an existing region in place rather than appending a second one", () => {
    const once = applyRegion("## ctx surface\n\nhand-written prose\n", ENTRIES);
    expect(once.match(new RegExp(GENERATED_REGION_START, "gu"))?.length).toBe(1);

    const edited = once.replace("new Raycaster(", "new Raycaster() by hand");
    const twice = applyRegion(edited, ENTRIES);
    expect(twice).toBe(once);
  });

  it("appends the region to a fragment that never had one", () => {
    const applied = applyRegion("# fragment\n", []);
    expect(applied).toContain(GENERATED_REGION_START);
    expect(applied).toContain("|---|---|---|");
    expect(applied.trimEnd().endsWith("<!-- /generated -->")).toBe(true);
  });
});
