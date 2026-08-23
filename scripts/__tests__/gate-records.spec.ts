import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultRunId,
  finishGateRecord,
  heartbeatGateRecord,
  startGateRecord,
} from "../gate-records.mjs";
import { readGateStatus } from "../gate-status.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempStatusPath(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gate-records-"));
  temporaryRoots.push(root);
  return path.join(root, "status.json");
}

const identity = {
  owner: "lane-hygiene@spec",
  phase: "spec",
  pid: process.pid,
  runId: defaultRunId(),
};

describe("gate records writer", () => {
  it("writes a running record the gate-status reader validates unchanged", async () => {
    const statusPath = await tempStatusPath();
    await startGateRecord({ ...identity, statusPath, command: "pnpm parity (spec)" });

    const record = await readGateStatus(statusPath);
    expect(record.state).toBe("running");
    expect(record.phase).toBe("spec");
    expect(record.owner).toBe(identity.owner);
    expect(record.command).toBe("pnpm parity (spec)");
    expect(record.artifact.identity).toBe(`${identity.runId}:spec`);
    expect(record.worktree.head).toMatch(/^[0-9a-f]{40}$/u);
    expect(record.exitCode).toBeNull();
    expect(record.terminalResult).toBeNull();
  });

  it("refreshes the heartbeat without touching startedAt or identity", async () => {
    const statusPath = await tempStatusPath();
    // Anchor the fake clock at real now and advance it well inside the reader's 5 s
    // future-skew tolerance, so the timestamps stay distinct but never "in the future".
    let clock = new Date();
    const now = () => {
      clock = new Date(clock.getTime() + 1_000);
      return clock;
    };
    await startGateRecord({ ...identity, statusPath, command: "cmd", now });
    const started = JSON.parse(await readFile(statusPath, "utf8")) as { startedAt: string };

    await heartbeatGateRecord({ ...identity, statusPath, now });
    const updated = JSON.parse(await readFile(statusPath, "utf8")) as {
      startedAt: string;
      heartbeatAt: string;
      state: string;
    };
    expect(updated.startedAt).toBe(started.startedAt);
    expect(updated.heartbeatAt).toBe(clock.toISOString());
    expect(updated.state).toBe("running");
    await expect(readGateStatus(statusPath)).resolves.toBeDefined();
  });

  it("finishes terminally and refuses updates once terminal", async () => {
    const statusPath = await tempStatusPath();
    await startGateRecord({ ...identity, statusPath, command: "cmd" });
    await finishGateRecord({ ...identity, statusPath, exitCode: 3 });

    const record = await readGateStatus(statusPath);
    expect(record.state).toBe("failed");
    expect(record.exitCode).toBe(3);
    expect(record.terminalResult?.state).toBe("failed");

    // Fail closed: nothing may resurrect or append to a terminal record.
    await expect(heartbeatGateRecord({ ...identity, statusPath })).rejects.toThrow(
      /already terminal/u,
    );
  });

  it("fails closed when heartbeating a foreign or missing record", async () => {
    const statusPath = await tempStatusPath();
    await expect(heartbeatGateRecord({ ...identity, statusPath })).rejects.toThrow(
      /missing or not valid JSON/u,
    );

    await startGateRecord({ ...identity, statusPath, command: "cmd" });
    // The writer throws its own error; GateStatusError is the reader's vocabulary.
    await expect(
      heartbeatGateRecord({ ...identity, owner: "someone@else", statusPath }),
    ).rejects.toThrow(/identity changed/u);
    await expect(readGateStatus(statusPath)).resolves.toMatchObject({ state: "running" });
  });
});
