/**
 * Records the pinned reference's answer to every fixture, in Node, without a browser.
 *
 *   pnpm --filter @threenative/three-native test:reference
 *   pnpm --filter @threenative/three-native test:reference -- --repeat 2
 *   pnpm --filter @threenative/three-native test:reference -- --check
 *
 * Goldens land in `goldens/<three version>/<fixture>.json`, keyed by the workspace catalog pin so
 * a reference upgrade lands new files instead of silently overwriting old ones. `--check` proves
 * the committed goldens are what this reference produces today; `--repeat N` proves two runs of
 * the same corpus agree, which is what makes a golden usable as an oracle at all.
 *
 * A render fixture is reported `blocked` here. Executing it needs the playtest harness and a GPU
 * adapter; N01 phase 1 does not build one, so the row exists and says so.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  FIXTURES_DIR,
  type FixtureArg,
  type IFixture,
  type IFixtureGolden,
  type IGoldenObservation,
  REPO_ROOT,
  goldenPath,
  loadFixtures,
  pinnedThreeVersion,
  writeGolden,
} from "../../src/fixture-format.js";
import { encodeObservation, namedNumber } from "../../src/fixture-protocol.js";

const RENDER_BLOCKED =
  "render fixtures need the playtest harness (N01 phase 1 follow-up): this reference run has no GPU adapter, so no pixel or lit-frame observation was recorded";

/** The pinned `three`, from whichever package in the workspace links the same store copy. */
async function loadReference(): Promise<{
  readonly three: Record<string, unknown>;
  readonly version: string;
}> {
  const expected = pinnedThreeVersion(REPO_ROOT);
  for (const owner of ["three-native", "runtime-native", "core"]) {
    const require = createRequire(path.join(REPO_ROOT, "packages", owner, "package.json"));
    let entry: string;
    try {
      entry = require.resolve("three");
    } catch {
      continue;
    }
    const build = path.dirname(entry);
    const manifest = JSON.parse(readFileSync(path.join(build, "..", "package.json"), "utf8")) as {
      version: string;
    };
    if (manifest.version !== expected)
      throw new Error(
        `TN_FIXTURE_THREE_MISMATCH: packages/${owner} links three ${manifest.version}, the workspace catalog pins ${expected}`,
      );
    const three = (await import(pathToFileURL(path.join(build, "three.module.js")).href)) as Record<
      string,
      unknown
    >;
    return { three, version: manifest.version };
  }
  throw new Error("TN_FIXTURE_THREE_MISSING: no workspace package links the catalog three");
}

/** Turns one fixture argument into the value the reference method receives. */
function argument(arg: FixtureArg, bound: ReadonlyMap<string, unknown>): unknown {
  if (arg !== null && typeof arg === "object") {
    if ("ref" in arg) {
      const found = bound.get(arg.ref);
      if (found === undefined) throw new Error(`TN_FIXTURE_UNBOUND: ${arg.ref} has no value`);
      return found;
    }
    return namedNumber(arg.num);
  }
  return arg;
}

function readPath(root: unknown, dotted: string): unknown {
  let current = root;
  for (const segment of dotted.split(".")) {
    if (current === null || current === undefined)
      throw new Error(`TN_FIXTURE_PATH_MISSING: ${dotted} leaves ${String(current)}`);
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function writePath(root: unknown, dotted: string, value: unknown): void {
  const segments = dotted.split(".");
  const last = segments.pop();
  if (last === undefined) throw new Error(`TN_FIXTURE_PATH_INVALID: ${dotted}`);
  let current = root as Record<string, unknown>;
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || next === undefined)
      throw new Error(`TN_FIXTURE_PATH_MISSING: ${dotted} leaves ${String(next)}`);
    current = next as Record<string, unknown>;
  }
  current[last] = value;
}

/** Every fixture name, in the order a driver receives the observe commands. */
export async function referenceGolden(fixture: IFixture): Promise<IFixtureGolden> {
  if (fixture.render === true)
    return {
      name: fixture.name,
      threeVersion: pinnedThreeVersion(REPO_ROOT),
      adaptedFrom: fixture.adaptedFrom,
      blocked: RENDER_BLOCKED,
      observations: [],
    };
  const { three, version } = await loadReference();
  const bound = new Map<string, unknown>();
  for (const op of fixture.ops) {
    if (op.op === "new") {
      const Constructor = three[op.class];
      if (typeof Constructor !== "function")
        throw new Error(
          `TN_FIXTURE_CLASS_UNKNOWN: ${op.class} is not exported by three ${version}`,
        );
      bound.set(
        op.id,
        new (Constructor as new (...args: unknown[]) => unknown)(
          ...op.args.map((arg) => argument(arg, bound)),
        ),
      );
      continue;
    }
    const target = bound.get(op.id);
    if (target === undefined) throw new Error(`TN_FIXTURE_UNBOUND: ${op.id} has no value`);
    const holder = target as Record<string, unknown>;
    if (op.op === "set") {
      writePath(target, op.path, argument(op.value, bound));
      continue;
    }
    const method = holder[op.method];
    if (typeof method !== "function")
      throw new Error(`TN_FIXTURE_METHOD_UNKNOWN: ${op.id}.${op.method} is not callable`);
    const returned = (method as (...args: unknown[]) => unknown).apply(
      target,
      op.args.map((arg) => argument(arg, bound)),
    );
    if (op.result !== undefined) bound.set(op.result, returned);
  }

  const observations: IGoldenObservation[] = fixture.observe.map((observation, index) => {
    const target = bound.get(observation.id);
    if (target === undefined) throw new Error(`TN_FIXTURE_UNBOUND: ${observation.id} has no value`);
    const holder = target as Record<string, unknown>;
    const value =
      observation.path !== undefined
        ? readPath(target, observation.path)
        : observation.method === undefined
          ? target
          : (() => {
              const method = holder[observation.method];
              if (typeof method !== "function")
                throw new Error(
                  `TN_FIXTURE_METHOD_UNKNOWN: ${observation.id}.${observation.method} is not callable`,
                );
              return (method as () => unknown).call(target);
            })();
    if (value === undefined)
      throw new Error(
        `TN_FIXTURE_PATH_MISSING: observation ${index} read ${observation.path ?? observation.method ?? "the bound value"} as undefined`,
      );
    const encoded = encodeObservation(observation.kind, value);
    return {
      index,
      id: observation.id,
      kind: observation.kind,
      ...(observation.path === undefined ? {} : { path: observation.path }),
      ...(observation.method === undefined ? {} : { method: observation.method }),
      value: encoded.value,
      decimal: encoded.decimal,
    };
  });
  return {
    name: fixture.name,
    threeVersion: version,
    adaptedFrom: fixture.adaptedFrom,
    blocked: null,
    observations,
  };
}

/** The run itself: one pass over the corpus. `--repeat` and `--check` wrap this. */
async function main(argv: readonly string[]): Promise<number> {
  const repeat = Number(valueAfter(argv, "--repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error("TN_FIXTURE_ARG_INVALID: --repeat needs a positive integer");
  const check = argv.includes("--check");
  const fixtures = loadFixtures(FIXTURES_DIR);
  const version = pinnedThreeVersion(REPO_ROOT);

  let goldens = await Promise.all(fixtures.map((fixture) => referenceGolden(fixture)));
  if (repeat > 1) {
    for (let round = 2; round <= repeat; round += 1) {
      const again = await Promise.all(fixtures.map((fixture) => referenceGolden(fixture)));
      again.forEach((golden, index) => {
        if (JSON.stringify(golden) !== JSON.stringify(goldens[index]))
          throw new Error(
            `TN_FIXTURE_NOT_REPRODUCIBLE: ${golden.name} differs between run 1 and run ${round}`,
          );
      });
      goldens = again;
    }
  }

  const problems: string[] = [];
  for (const golden of goldens) {
    const file = path.join("tests", "compatibility", "goldens", version, `${golden.name}.json`);
    if (check) {
      const committed = goldenPath(golden.name, version);
      const actual = existsSync(committed) ? readFileSync(committed, "utf8") : null;
      const regenerated = `${JSON.stringify(golden, null, 2)}\n`;
      if (actual !== regenerated)
        problems.push(
          `${file}: ${actual === null ? "missing" : "differs from the regenerated golden"}`,
        );
      continue;
    }
    process.stdout.write(`${writeGolden(golden, version)}\n`);
  }

  const blocked = goldens.filter((golden) => golden.blocked !== null);
  process.stdout.write(
    `${JSON.stringify(
      {
        threeVersion: version,
        fixtures: goldens.length,
        observations: goldens.reduce((total, golden) => total + golden.observations.length, 0),
        blocked: blocked.map((golden) => ({ name: golden.name, reason: golden.blocked })),
        repeats: repeat,
        ...(check ? { checked: true } : { wrote: goldens.length }),
        ...(problems.length === 0 ? {} : { problems }),
      },
      null,
      2,
    )}\n`,
  );
  return problems.length === 0 ? 0 : 1;
}

function valueAfter(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index === -1 ? null : (argv[index + 1] ?? null);
}

/** Only the CLI owns the exit code; a spec that imports `referenceGolden` must not run a pass. */
if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
