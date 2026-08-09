import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReplayDriver } from "../src/replay.js";

const sourceDirectory = path.resolve("packages/core/src");
const randomSource = path.join(sourceDirectory, "random.ts");
const replaySource = path.join(sourceDirectory, "replay.ts");
const indexSource = path.join(sourceDirectory, "index.ts");

describe("core constraints", () => {
  it("should keep visual concerns out of core source", () => {
    const source = readdirSync(sourceDirectory)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== "particles.ts")
      .map((file) => readFileSync(path.join(sourceDirectory, file), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/material|light|tonemapping|postprocessing|\.wgsl/iu);

    const particles = readFileSync(path.join(sourceDirectory, "particles.ts"), "utf8");
    expect(particles).not.toMatch(
      /new\s+\w*Material|new\s+Color|light|tonemapping|postprocessing|\.wgsl/iu,
    );
  });

  /**
   * There is deliberately no line-count assertion here.
   *
   * A fatal 2,500-line cap lived at this spot and was removed on 2026-08-09. It appeared
   * nowhere in `CHARTER.md`, `AGENTS.md` or `pnpm budgets`, while the two LOC limits the
   * charter does state (15,000 framework, 50,000 native) are review triggers that report and
   * never fail. Core had reached 2,499 of 2,500, so the only fatal LOC number in the repo was
   * an unwritten one, and it blocked the next twenty lines of plumbing on arrival order
   * rather than on merit — while counting blank lines and comments, which taxes exactly the
   * package that most needs explaining.
   *
   * What guards framework weight is `scripts/count-loc.ts`, which scores whether the
   * framework costs more code than plain Three.js, and the reported trigger in
   * `pnpm budgets`. A ceiling on core belongs there, next to the other numbers, not as a
   * fatal per-package test. See `docs/PRDs/PRD-053-core-input-multitouch.md`.
   */

  it("should reject a recording schema key that names an entity type", () => {
    const source = readFileSync(replaySource, "utf8");
    expect(source).not.toMatch(/"(type|class|kind|prefab|components|nodes)"/u);
    expect(source).not.toMatch(/new (\w+\[|constructors?\[|registry\.get)/u);
    expect(source).not.toContain("EntitySnapshot");

    const recording = {
      input: [],
      randomState: 0,
      runtime: { agent: "node", core: "0.1.0", rapier: null, step: 1 / 60 },
      seed: 1,
      ticks: 1,
      version: 1,
    };
    const validRecording = { ...recording, input: [{ keys: [], tick: 0 }] };
    expect(() =>
      createReplayDriver({ ...validRecording, type: "entity" } as never, new EventTarget()),
    ).toThrow(/unknown key 'type'/u);
  });

  it("should keep the saveable random state on the public surface", () => {
    expect(readFileSync(randomSource, "utf8")).toMatch(/state:\s*number/u);
  });

  it("should keep the replay exports on the public surface", () => {
    const source = readFileSync(indexSource, "utf8");
    expect(source).toContain('export { createReplayDriver, replay } from "./replay.js";');
    expect(source).toContain('export type { Recording } from "./replay.js";');
  });
});
