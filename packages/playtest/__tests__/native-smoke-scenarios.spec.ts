import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const smoke = join(repo, "examples", "native-smoke");

/** Every entity id the native smoke scene registers with the playtest bridge. */
function registeredEntities(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const file of ["game.ts", "physics.ts"]) {
    const source = readFileSync(join(smoke, "src", file), "utf8");
    for (const match of source.matchAll(/ctx\.entities\.add\(\s*"([^"]+)"/gu)) ids.add(match[1]);
  }
  expect(ids.size).toBeGreaterThan(0);
  return ids;
}

/** Entity ids a scenario's assertions name. */
function assertedEntities(scenario: Record<string, unknown>): readonly string[] {
  const assertions = scenario.assert as Record<string, unknown> | undefined;
  if (assertions === undefined) return [];
  const named: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (typeof record.entity === "string") named.push(record.entity);
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(assertions);
  return named;
}

// `device-smoke.playtest.json` asserted movement for an entity called "player", and this scene has
// never registered one — `entities.add("player", …)` appears nowhere in its history. The assertion
// failed closed exactly as designed ("Entity 'player' was never observed"), but only the device
// lanes run these scenarios and neither has ever been green, so nothing ever read the verdict.
// `physics.ts` registers its ids from a table, so those are covered by the same walk.
test("every entity a native-smoke scenario asserts on is one the scene registers", () => {
  const registered = registeredEntities();
  const dynamic = readFileSync(join(smoke, "src", "physics.ts"), "utf8").includes(
    "ctx.entities.add(spec.name",
  );
  const offenders: string[] = [];
  for (const file of readdirSync(join(smoke, "playtests"))) {
    if (!file.endsWith(".json")) continue;
    // The deliberately-invalid scenario is parsed by the runner, not by this guard.
    if (file.includes("misspelled")) continue;
    const scenario = JSON.parse(readFileSync(join(smoke, "playtests", file), "utf8"));
    for (const entity of assertedEntities(scenario)) {
      if (registered.has(entity)) continue;
      // Physics scenarios name bodies from a runtime spec table this guard cannot enumerate.
      if (dynamic && file.startsWith("physics")) continue;
      offenders.push(`${file}: ${entity}`);
    }
  }
  expect(offenders).toEqual([]);
});
