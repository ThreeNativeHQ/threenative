import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sealedProofFiles } from "../make-sandbox";

const GENRES = [
  "physics-puzzle",
  "platformer",
  "topdown-action",
  "endless-runner",
  "exploration",
  "open-world",
] as const;

type ContractPinKind = "identifier" | "key" | "resource-id" | "resource-path" | "seed";

interface IContractPin {
  readonly kind: ContractPinKind;
  readonly path: string;
  readonly value: number | string;
}

interface IContractAuditRow {
  readonly file: string;
  readonly genre: string;
  readonly pins: readonly IContractPin[];
}

const ENTITY_FIELDS = new Set(["entity", "follows", "with"]);
const RESOURCE_ASSERTION_PATH = /^(?:assert|setup)\.resources(?:\[\d+\])(?:\.anyOf\[\d+\])?$/;
const RESOURCE_ID_ARRAY_PATH = /^parity(?:\.compare)?\.resources$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`;
  return parent === "" ? key : `${parent}.${key}`;
}

function addPressPins(value: unknown, fieldPath: string, pins: IContractPin[]): void {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  for (const [index, key] of values.entries()) {
    if (typeof key === "string") {
      pins.push({
        kind: "key",
        path: Array.isArray(value) ? `${fieldPath}[${index}]` : fieldPath,
        value: key,
      });
    }
  }
}

function recordContractPin(
  currentPath: string,
  key: string,
  entry: unknown,
  entryPath: string,
  pins: IContractPin[],
  resourceId: string | undefined,
): void {
  if (currentPath === "" && key === "subject" && typeof entry === "string") {
    pins.push({ kind: "identifier", path: entryPath, value: entry });
  }
  if (currentPath.startsWith("steps") && key === "press") addPressPins(entry, entryPath, pins);
  if (entryPath === "assert.world.seed" && typeof entry === "number" && Number.isFinite(entry)) {
    pins.push({ kind: "seed", path: entryPath, value: entry });
  }
  if (currentPath.startsWith("assert.") && ENTITY_FIELDS.has(key) && typeof entry === "string") {
    pins.push({ kind: "identifier", path: entryPath, value: entry });
  }
  if (currentPath === "assert.occluded" && key === "target" && typeof entry === "string") {
    pins.push({ kind: "identifier", path: entryPath, value: entry });
  }
  if (RESOURCE_ASSERTION_PATH.test(currentPath) && key === "id" && typeof entry === "string") {
    pins.push({ kind: "resource-id", path: entryPath, value: entry });
  }
  if (RESOURCE_ASSERTION_PATH.test(currentPath) && key === "path" && typeof entry === "string") {
    if (resourceId === undefined)
      throw new Error(`Resource path '${entryPath}' has no resource id.`);
    pins.push({ kind: "resource-path", path: entryPath, value: `${resourceId}.${entry}` });
  }
}

function walkContractPins(
  current: unknown,
  currentPath: string,
  pins: IContractPin[],
  resourceId: string | undefined = undefined,
): void {
  if (Array.isArray(current)) {
    current.forEach((entry, index) => {
      const entryPath = childPath(currentPath, index);
      if (RESOURCE_ID_ARRAY_PATH.test(currentPath) && typeof entry === "string") {
        pins.push({ kind: "resource-id", path: entryPath, value: entry });
      }
      walkContractPins(entry, entryPath, pins, resourceId);
    });
    return;
  }
  if (!isRecord(current)) return;
  const currentResourceId =
    RESOURCE_ASSERTION_PATH.test(currentPath) && typeof current.id === "string"
      ? current.id
      : resourceId;
  for (const [key, entry] of Object.entries(current)) {
    const entryPath = childPath(currentPath, key);
    recordContractPin(currentPath, key, entry, entryPath, pins, currentResourceId);
    walkContractPins(entry, entryPath, pins, currentResourceId);
  }
}

function collectContractPins(value: unknown): readonly IContractPin[] {
  const pins: IContractPin[] = [];
  walkContractPins(value, "", pins);
  return pins;
}

function briefStatesPin(brief: string, pin: IContractPin): boolean {
  return brief.includes(`\`${String(pin.value)}\``);
}

function assertScenarioContract(
  genre: string,
  brief: string,
  scenario: unknown,
  file: string,
): readonly IContractPin[] {
  const pins = collectContractPins(scenario);
  const missing = pins.filter((pin) => !briefStatesPin(brief, pin));
  if (missing.length > 0) {
    const details = missing
      .map((pin) => `${genre}: ${pin.path} pins ${pin.kind} ${JSON.stringify(pin.value)}`)
      .join("\n");
    throw new Error(`Sealed contract audit failed for ${file}; brief.md omits:\n${details}`);
  }
  return pins;
}

async function auditSealedContracts(repo: string): Promise<readonly IContractAuditRow[]> {
  const rows: IContractAuditRow[] = [];
  for (const genre of GENRES) {
    const brief = await readFile(
      path.join(repo, "docs/benchmark/genres", genre, "brief.md"),
      "utf8",
    );
    for (const proof of sealedProofFiles(repo, genre)) {
      const scenario = JSON.parse(await readFile(proof.absolutePath, "utf8")) as unknown;
      rows.push({
        file: proof.relativePath,
        genre,
        pins: assertScenarioContract(genre, brief, scenario, proof.relativePath),
      });
    }
  }
  return rows;
}

describe("sealed contract audit", () => {
  it("covers all six genres and states every pinned input", async () => {
    const rows = await auditSealedContracts(process.cwd());
    expect(new Set(rows.map(({ genre }) => genre))).toEqual(new Set(GENRES));
    expect(
      rows.every(({ pins }) =>
        pins.every(
          ({ kind }) =>
            kind === "identifier" ||
            kind === "key" ||
            kind === "resource-id" ||
            kind === "resource-path" ||
            kind === "seed",
        ),
      ),
    ).toBe(true);
    expect(rows.flatMap(({ pins }) => pins)).toEqual(
      expect.arrayContaining([
        { kind: "seed", path: "assert.world.seed", value: 6132 },
        { kind: "key", path: "steps[2].press", value: "ArrowRight" },
        { kind: "key", path: "steps[0].press", value: "KeyV" },
        { kind: "resource-id", path: "assert.resources[0].id", value: "state" },
        { kind: "resource-path", path: "assert.resources[0].path", value: "state.replayPhase" },
      ]),
    );
  });

  it("keeps the physics proof brief free of gameplay identifiers", async () => {
    const brief = await readFile(
      path.join(process.cwd(), "docs/benchmark/genres/physics-puzzle/brief.md"),
      "utf8",
    );
    for (const forbidden of ["player", "ghost", "goal", "physics.body."]) {
      expect(brief.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("fails closed when a named entity is re-added", async () => {
    const genre = "physics-puzzle";
    const brief = await readFile(
      path.join(process.cwd(), "docs/benchmark/genres", genre, "brief.md"),
      "utf8",
    );
    const proof = path.join(
      process.cwd(),
      "docs/benchmark/genres/physics-puzzle/proof/physics-puzzle.playtest.json",
    );
    const scenario = JSON.parse(await readFile(proof, "utf8")) as Record<string, unknown>;
    scenario.subject = "unsealed-player";

    expect(() =>
      assertScenarioContract(genre, brief, scenario, "physics-puzzle.playtest.json"),
    ).toThrow(/physics-puzzle: subject pins identifier "unsealed-player"/);
  });

  it("fails closed when a pinned resource id or path is re-added", async () => {
    const genre = "physics-puzzle";
    const brief = await readFile(
      path.join(process.cwd(), "docs/benchmark/genres", genre, "brief.md"),
      "utf8",
    );
    const proof = path.join(
      process.cwd(),
      "docs/benchmark/genres/physics-puzzle/proof/physics-puzzle-replay.playtest.json",
    );
    const scenario = JSON.parse(await readFile(proof, "utf8")) as {
      assert?: { resources?: Array<{ id?: string; path?: string }> };
    };
    const resource = scenario.assert?.resources?.[1];
    if (resource === undefined)
      throw new Error("Physics replay proof is missing its second resource.");

    resource.id = "stateMismatch";
    expect(() =>
      assertScenarioContract(genre, brief, scenario, "physics-puzzle-replay.playtest.json"),
    ).toThrow(/physics-puzzle: assert\.resources\[1\]\.id pins resource-id "stateMismatch"/);

    resource.id = "state";
    resource.path = "replayMismatch";

    expect(() =>
      assertScenarioContract(genre, brief, scenario, "physics-puzzle-replay.playtest.json"),
    ).toThrow(
      /physics-puzzle: assert\.resources\[1\]\.path pins resource-path "state\.replayMismatch"/,
    );
  });
});
