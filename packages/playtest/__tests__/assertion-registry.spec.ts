import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { IPlaytestAssertionSchemaEntry } from "../src/assertions.js";
import { assertPlaytestAssertionRegistryComplete, PLAYTEST_ASSERTION_REGISTRY } from "../src/assertions.js";
import { renderGeneratedAssertionTypes, renderGeneratedAssertionValidators } from "../../../scripts/generate-assertion-validators.js";

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
    const renderTypes = renderGeneratedAssertionTypes as unknown as (
      registry: readonly IPlaytestAssertionSchemaEntry[],
    ) => string;

    expect(render(registry)).toContain('"name": "registryOnlyField"');
    expect(renderTypes(registry)).toContain("registryOnlyField?: string");
  });

  it("rejects a typo in an entry-level rule field reference", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "tags"
        ? {
            ...entry,
            rules: entry.rules?.map((rule) =>
              rule.kind === "requireOneOf"
                ? { ...rule, fields: ["counnt", "gte", "lte"] }
                : rule,
            ),
          }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: tags.counnt is not declared in the registry fields.",
    );
  });

  it("rejects a typo in a nested record-rule field reference", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) => {
      if (entry.kind !== "resources") return entry;
      return {
        ...entry,
        fields: entry.fields.map((field) => {
          if (field.name !== "anyOf" || field.constraints.kind !== "array" || field.constraints.items.kind !== "record") {
            return field;
          }
          return {
            ...field,
            constraints: {
              ...field.constraints,
              items: {
                ...field.constraints.items,
                rules: field.constraints.items.rules?.map((rule) =>
                  rule.kind === "requireOneOf"
                    ? { ...rule, fields: ["equals", "gte", "ltee", "textIncludes", "changed"] }
                    : rule,
                ),
              },
            },
          };
        }),
      };
    }) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: resources.anyOf[].ltee is not declared in the registry fields.",
    );
  });

  it("rejects an unknown required field on an excludeFields variant", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "resources"
        ? {
            ...entry,
            variants: entry.variants?.map((variant) =>
              variant.excludeFields === undefined
                ? variant
                : { ...variant, requiredFields: ["idd"] },
            ),
          }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: resources.idd is not declared in the registry fields.",
    );
  });

  it("rejects an unknown discriminator field", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "resources"
        ? { ...entry, discriminator: { field: "anyOfTypo", presentVariant: 0 } }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: resources.discriminator.anyOfTypo is not declared in the registry fields.",
    );
  });

  it("rejects a discriminator field declared only by another variant", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "resources"
        ? { ...entry, discriminator: { field: "path", presentVariant: 0 } }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: resources.discriminator.path must be declared exclusively by presentVariant 0.",
    );
  });

  it("rejects an out-of-range discriminator variant", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "resources"
        ? { ...entry, discriminator: { field: "anyOf", presentVariant: 2 } }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: resources.discriminator.presentVariant 2 is out of range for 2 variants.",
    );
  });

  it("rejects a no-consecutive-duplicates rule on a non-array field", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "reachability"
        ? {
            ...entry,
            rules: entry.rules?.map((rule) =>
              rule.kind === "noConsecutiveDuplicates" ? { ...rule, field: "artifact" } : rule,
            ),
          }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: reachability.noConsecutiveDuplicates field 'artifact' must reference an array constraint.",
    );
  });

  it("rejects a require-when rule on a non-boolean field", () => {
    const registry = PLAYTEST_ASSERTION_REGISTRY.map((entry) =>
      entry.kind === "diagnostics"
        ? {
            ...entry,
            rules: entry.rules?.map((rule, index) =>
              rule.kind === "requireWhen" && index === 0 ? { ...rule, field: "consoleErrorsOptOutReason" } : rule,
            ),
          }
        : entry,
    ) as readonly IPlaytestAssertionSchemaEntry[];

    expect(() => assertPlaytestAssertionRegistryComplete(registry)).toThrow(
      "Assertion registry is incomplete: diagnostics.requireWhen field 'consoleErrorsOptOutReason' must reference a boolean constraint.",
    );
  });

  it("keeps public assertion field contracts in generated source", async () => {
    const schemaBase = await readFile(path.join(repoRoot, "packages/playtest/src/scenario/schema-base.ts"), "utf8");
    const generatedTypes = await readFile(path.join(repoRoot, "packages/playtest/src/scenario/generated-assertion-types.ts"), "utf8");

    expect(schemaBase).not.toContain("export interface IPlaytestMovementAssertion");
    expect(generatedTypes).toContain("minTicks?: number");
  });

});
