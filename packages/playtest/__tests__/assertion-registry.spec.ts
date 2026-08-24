import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IPlaytestAssertionSchemaEntry } from "../src/assertions.js";
import { PLAYTEST_ASSERTION_REGISTRY } from "../src/assertions.js";
import { renderGeneratedAssertionValidators } from "../../../scripts/generate-assertion-validators.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const generatedValidatorPath = path.join(repoRoot, "packages/playtest/src/scenario/generated-assertion-validators.ts");

describe("assertion registry completeness", () => {
  it("declares a machine-readable constraint for every assertion field", () => {
    const gaps: string[] = [];
    for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
      for (const field of entry.fields) {
        if (field.constraints === undefined) gaps.push(`${entry.kind}.${field.name}`);
      }
    }

    expect(gaps, "RED first: fields whose checks still live only in hand-written validators").toEqual([]);
  });

  it("keeps the committed validator artifact generated from the registry", async () => {
    const generated = await readFile(generatedValidatorPath, "utf8");
    expect(generated, "generated assertion validators are stale; run the generator").toBe(
      renderGeneratedAssertionValidators(),
    );
  });

  it("includes a resource field added to the registry in generated validation", () => {
    const resources = PLAYTEST_ASSERTION_REGISTRY.find((entry) => entry.kind === "resources");
    expect(resources).toBeDefined();
    const addedField = {
      constraints: { kind: "string", nonEmpty: true } as const,
      description: "A synthetic registry-only field for the source-of-truth proof.",
      name: "registryOnlyField",
      type: "string",
    };
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "resources" ? { ...entry, fields: [...entry.fields, addedField] } : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];
    const render = renderGeneratedAssertionValidators as unknown as (
      registry: readonly IPlaytestAssertionSchemaEntry[],
    ) => string;

    expect(render(registry)).toContain('"name": "registryOnlyField"');
  });

});
