/**
 * Incremental strict builds (PRD-530, Solution item 3): the compiler and the engine are prebuilt
 * inputs, so a game-source-only edit recompiles the TypeScript and relinks, and nothing else runs:
 * no engine or Dawn build, no compiler build, not even the shim or the hooks. The first part drives
 * buildStrict with recording tools; the second builds a real game with the pinned tslang against
 * this checkout's engine archives when both are on disk.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";
// @ts-expect-error -- plain ESM with no type declarations.
import { provision } from "../../../tools/native-typescript/provision.mjs";
// @ts-expect-error -- plain ESM with no type declarations.
import { ENGINE_LIBS, buildStrict } from "../scripts/package-strict.mjs";

interface IBuild {
  exe: string;
  ran: string[];
  errors: string[];
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function tempRoot(prefix: string): string {
  const root = makeTempDirSync(prefix);
  roots.push(root);
  return root;
}

const COMPILER = "/opt/tslang/tslang";

/**
 * Records every tool call and writes each output as a digest of the call and the source it reads,
 * so an unchanged source gives the same object and a changed one a different object.
 */
function recordingExec(calls: string[][], fail?: (tool: string, args: string[]) => boolean) {
  return (tool: string, args: string[]) => {
    calls.push([tool, ...args]);
    if (fail?.(tool, args)) return `${tool}: error: refused`;
    const outFlag = args.find((arg) => arg.startsWith("-o="));
    const flag = args.includes("-o") ? "-o" : "--write";
    const output = outFlag ? outFlag.slice(3) : args[args.indexOf(flag) + 1];
    if (output === undefined || !output.startsWith("/"))
      throw new Error(`no absolute output in ${args.join(" ")}`);
    const source = args.find((arg) => /\.(ts|c|cpp)$/u.test(arg));
    const hash = createHash("sha256").update(args.join(" "));
    if (source) hash.update(readFileSync(source));
    writeFileSync(output as string, hash.digest("hex"));
    return undefined;
  };
}

function setup() {
  const root = tempRoot("tn-strict-incremental-");
  const engineBuild = join(root, "engine");
  mkdirSync(engineBuild, { recursive: true });
  for (const lib of ENGINE_LIBS as string[]) writeFileSync(join(engineBuild, `lib${lib}.a`), lib);
  writeFileSync(join(engineBuild, "tn-native-engine-identity"), "identity tool");
  const entry = join(root, "game.ts");
  writeFileSync(entry, 'import { Scene } from "three";\nconsole.log(new Scene().type);\n');
  const calls: string[][] = [];
  const build = (exec = recordingExec(calls)): IBuild =>
    buildStrict({
      name: "game",
      entry,
      outDir: join(root, "out"),
      engineBuild,
      compiler: { binaryPath: COMPILER, identity: "tslang test" },
      exec,
    });
  return { root, engineBuild, entry, calls, build };
}

const toolsOf = (calls: string[][]) => calls.map(([tool]) => tool);

describe("strict builds are incremental", () => {
  it("builds every step once, then nothing while nothing changed", () => {
    const { calls, build } = setup();
    const first = build();
    expect(first.errors).toEqual([]);
    expect(first.ran).toEqual(["typescript", "shim", "hooks", "link", "identity"]);
    expect(existsSync(first.exe)).toBe(true);
    expect(existsSync(`${first.exe}.identity`)).toBe(true);
    calls.length = 0;
    const second = build();
    expect(second).toMatchObject({ errors: [], ran: [] });
    expect(calls).toEqual([]);
  });

  it("recompiles only the TypeScript and relinks after a game-source-only edit", () => {
    const { entry, calls, build } = setup();
    build();
    calls.length = 0;
    writeFileSync(entry, 'import { Scene } from "three";\nconsole.log(new Scene().name);\n');
    const rebuilt = build();
    expect(rebuilt.errors).toEqual([]);
    expect(rebuilt.ran).toEqual(["typescript", "link"]);
    // The compiler for each TypeScript module, then the one link; no cc, no hooks, no engine build.
    expect(toolsOf(calls)).toEqual([COMPILER, COMPILER, "c++"]);
    expect(calls.at(-1)).toContain("-o");
    expect(calls.flat().some((arg) => /cmake|ninja|download-deps/u.test(arg))).toBe(false);
  });

  it("rebuilds the hooks and relinks when the engine archives change, not the TypeScript", () => {
    const { engineBuild, calls, build } = setup();
    build();
    calls.length = 0;
    writeFileSync(join(engineBuild, "libtn_engine_scene.a"), "a newer engine");
    expect(build().ran).toEqual(["hooks", "link"]);
  });

  it("refuses a missing engine archive without building anything", () => {
    const { engineBuild, calls, build } = setup();
    rmSync(join(engineBuild, "libtn_engine_abi.a"));
    const result = build();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/^TN_STRICT_ENGINE_MISSING: .*libtn_engine_abi\.a/u);
    expect(calls).toEqual([]);
  });

  it("records nothing for a failed step, so the next build retries it", () => {
    const { calls, build } = setup();
    const failed = build(recordingExec(calls, (tool) => tool === COMPILER));
    expect(failed.errors[0]).toMatch(/error: refused/u);
    expect(failed.ran).toEqual(["typescript", "shim", "hooks"]);
    expect(build().ran).toEqual(["typescript", "link", "identity"]);
  });
});

const REPO = join(import.meta.dirname, "..", "..", "..");
const ENGINE_BUILD = join(REPO, "packages", "runtime-native", "build", "tn-linux");
const FIXTURE = join(REPO, "tools", "native-typescript", "corpus", "three-fixture.ts");
const compiler = await provision({ checkOnly: true, log: () => {} }).catch(() => undefined);
const realLane =
  compiler !== undefined &&
  (ENGINE_LIBS as string[]).every((lib) => existsSync(join(ENGINE_BUILD, `lib${lib}.a`))) &&
  existsSync(join(ENGINE_BUILD, "tn-native-engine-identity"));

describe.runIf(realLane)("a real strict build with the pinned tslang", () => {
  it("relinks a game edit without touching the engine, and the artifact runs and checks", () => {
    const root = tempRoot("tn-strict-real-");
    const entry = join(root, "game.ts");
    writeFileSync(entry, readFileSync(FIXTURE));
    const build = (): IBuild =>
      buildStrict({
        name: "game",
        entry,
        outDir: join(root, "out"),
        engineBuild: ENGINE_BUILD,
        compiler: {
          binaryPath: compiler.binaryPath,
          identity: `tslang ${compiler.lock.tag} ${compiler.artifact.sha256}`,
        },
      });
    const first = build();
    expect(first.errors).toEqual([]);
    expect(first.ran).toEqual(["typescript", "shim", "hooks", "link", "identity"]);
    writeFileSync(entry, `${readFileSync(FIXTURE, "utf8")}console.log("edited");\n`);
    const second = build();
    expect(second.errors).toEqual([]);
    expect(second.ran).toEqual(["typescript", "link"]);
    const run = spawnSync(second.exe, { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toBe(
      `${readFileSync(FIXTURE.replace(/\.ts$/u, ".expected"), "utf8")}edited\n`,
    );
    const check = spawnSync(
      join(ENGINE_BUILD, "tn-native-engine-identity"),
      ["--check", `${second.exe}.identity`],
      {
        encoding: "utf8",
      },
    );
    expect(check.stdout.trim()).toBe("TN_ARTIFACT_IDENTITY_OK");
  }, 300_000);
});
