import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

const SCRIPT = path.resolve("packages/create-threenative/agent-files/scripts/visual-loop.mjs");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const SOURCE_HASH = "a".repeat(64);

function hash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function runLoop(root: string) {
  const child = spawn(process.execPath, [SCRIPT, "--record", ".dream-loop/run-1/run.json"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const [code] = (await once(child, "close")) as [number | null];
  const output = Buffer.concat(stdout).toString("utf8");
  if (output.trim() === "")
    throw new Error(
      `visual-loop emitted no JSON (exit ${code}): ${Buffer.concat(stderr).toString("utf8")}`,
    );
  return { code, output: JSON.parse(output) as Record<string, unknown> };
}

async function fixtureRoot(
  round?: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  const root = await makeTempDir("threenative-visual-loop-");
  const runDirectory = path.join(root, ".dream-loop", "run-1");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "target.png"), PNG);
  if (round?.capture && typeof round.capture === "object" && round.capture !== null)
    await writeFile(path.join(runDirectory, "capture.png"), PNG);
  const record = {
    schemaVersion: 1,
    runId: "run-1",
    projectRoot: root,
    artifactRoot: ".dream-loop/run-1",
    builderIdentity: "builder-1",
    currentSourceSha256: SOURCE_HASH,
    target: { path: ".dream-loop/run-1/target.png", sha256: hash(PNG), revision: 1 },
    limits: {
      deadlineAt: new Date(Date.now() + 60_000).toISOString(),
      maxRounds: 6,
      maxImageRequests: 4,
    },
    requests: { pending: [], completed: [], unknown: [], failed: [] },
    rounds: round === undefined ? [] : [round],
    decisionHistory: [],
    ...overrides,
  };
  await writeFile(path.join(runDirectory, "run.json"), `${JSON.stringify(record)}\n`);
  return root;
}

function eligibleRound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    round: 1,
    platform: "browser",
    adapter: "webgpu",
    capture: {
      path: ".dream-loop/run-1/capture.png",
      sha256: hash(PNG),
      targetSha256: hash(PNG),
      sourceSha256: SOURCE_HASH,
    },
    functional: { assertions: [{ name: "journal-visible", passed: true }] },
    performance: { targetFps: 30, displayMaxFps: 60, windows: [{ fps: 60 }, { fps: 59 }] },
    review: {
      status: "PASS",
      criticIdentity: "critic-1",
      targetSha256: hash(PNG),
      captureSha256: hash(PNG),
      framing: 3,
      lighting: 2,
      material: 2,
      finish: 1,
      blockers: [],
      gaps: [],
    },
    ...overrides,
  };
}

describe("generated visual-loop validator", () => {
  it("rejects stale captures and never accepts an old target hash", async () => {
    const root = await fixtureRoot(
      eligibleRound({
        capture: {
          path: ".dream-loop/run-1/capture.png",
          sha256: "b".repeat(64),
          targetSha256: hash(PNG),
          sourceSha256: SOURCE_HASH,
        },
      }),
    );
    try {
      const result = await runLoop(root);
      expect(result.code).toBe(0);
      expect(result.output).toMatchObject({
        decision: "unavailable",
        reason: "capture-hash-mismatch",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reconciles an interrupted request and refuses another paid request", async () => {
    const root = await fixtureRoot(undefined, {
      limits: {
        deadlineAt: new Date(Date.now() + 60_000).toISOString(),
        maxRounds: 6,
        maxImageRequests: 1,
      },
      requests: { pending: [{ requestId: "target-001" }], completed: [], unknown: [], failed: [] },
    });
    try {
      const result = await runLoop(root);
      expect(result.output).toMatchObject({
        decision: "budget-exhausted",
        reason: "image-request-limit",
      });
      const record = JSON.parse(
        await readFile(path.join(root, ".dream-loop/run-1/run.json"), "utf8"),
      ) as {
        requests: { pending: unknown[]; unknown: Array<{ requestId: string; category: string }> };
      };
      expect(record.requests.pending).toHaveLength(0);
      expect(record.requests.unknown).toEqual([
        expect.objectContaining({ requestId: "target-001", category: "interrupted" }),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("uses one replan for repeated gaps and then stops stalled", async () => {
    const gapRound = {
      ...eligibleRound({
        round: 1,
        review: {
          status: "REQUEST_CHANGES",
          criticIdentity: "critic-1",
          targetSha256: hash(PNG),
          captureSha256: hash(PNG),
          framing: 2,
          lighting: 2,
          material: 2,
          finish: 1,
          blockers: [],
          gaps: ["tower roof is too flat"],
        },
      }),
      round: 1,
    };
    const second = { ...gapRound, round: 2 };
    const root = await fixtureRoot(second, { rounds: [gapRound, second] });
    try {
      const first = await runLoop(root);
      expect(first.output).toMatchObject({
        decision: "replan",
        reason: "repeated-gaps-require-one-replan",
      });
      const repeatedCheck = await runLoop(root);
      expect(repeatedCheck.output).toMatchObject({
        decision: "replan",
        reason: "repeated-gaps-require-one-replan",
      });
      const recordPath = path.join(root, ".dream-loop/run-1/run.json");
      const record = JSON.parse(await readFile(recordPath, "utf8")) as {
        rounds: Array<Record<string, unknown>>;
        replanRound?: number;
      };
      expect(record.replanRound).toBe(2);
      record.rounds.push({ ...second, round: 3 });
      await writeFile(recordPath, `${JSON.stringify(record)}\n`);
      const laterRound = await runLoop(root);
      expect(laterRound.output).toMatchObject({
        decision: "stalled",
        reason: "replan-did-not-improve-repeated-gaps",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only a fresh independent review with functional and measured performance proof", async () => {
    const root = await fixtureRoot(eligibleRound());
    try {
      const result = await runLoop(root);
      expect(result.output).toMatchObject({
        decision: "accepted",
        score: 8,
        reason: "all-required-evidence-observed",
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses missing observations, invalid scores, and an uncapped zero FPS bound", async () => {
    const missingRoot = await fixtureRoot(eligibleRound({ review: undefined }));
    try {
      const result = await runLoop(missingRoot);
      expect(result.output).toMatchObject({
        decision: "unavailable",
        reason: "independent-review-missing",
      });
    } finally {
      await rm(missingRoot, { force: true, recursive: true });
    }
    const uncappedRoot = await fixtureRoot(
      eligibleRound({ performance: { targetFps: 0, displayMaxFps: 0, windows: [{ fps: 0 }] } }),
    );
    try {
      const result = await runLoop(uncappedRoot);
      expect(result.output).toMatchObject({
        decision: "unavailable",
        reason: "performance-observation-missing",
      });
    } finally {
      await rm(uncappedRoot, { force: true, recursive: true });
    }
    const missingDisplayRoot = await fixtureRoot(
      eligibleRound({ performance: { targetFps: 30, windows: [{ fps: 60 }] } }),
    );
    try {
      const result = await runLoop(missingDisplayRoot);
      expect(result.output).toMatchObject({
        decision: "unavailable",
        reason: "performance-observation-missing",
      });
    } finally {
      await rm(missingDisplayRoot, { force: true, recursive: true });
    }
    const invalidScoreRoot = await fixtureRoot(
      eligibleRound({
        review: {
          status: "PASS",
          criticIdentity: "critic-1",
          targetSha256: hash(PNG),
          captureSha256: hash(PNG),
          framing: 4,
          lighting: 2,
          material: 2,
          finish: 1,
          blockers: [],
          gaps: [],
        },
      }),
    );
    try {
      const result = await runLoop(invalidScoreRoot);
      expect(result.code).toBe(2);
      expect(result.output.category).toBe("invalid-input");
    } finally {
      await rm(invalidScoreRoot, { force: true, recursive: true });
    }
  });
});
