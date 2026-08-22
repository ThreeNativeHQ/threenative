import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import {
  type IGateStatusRecord,
  type IGateStatusStart,
  finishGatePhase,
  heartbeatGatePhase,
  readGateStatus,
  startGatePhase,
} from "../gate-status.js";
import type { IWorktreeLease, IWorktreeRecord } from "../worktree-lifecycle.js";

const worktree: IWorktreeRecord = {
  branch: "refs/heads/main",
  head: "1111111111111111111111111111111111111111",
  path: "/workspace/threenative",
};

const lease: IWorktreeLease = {
  branch: worktree.branch,
  expectedHead: worktree.head,
  owner: "agent@example",
  path: worktree.path,
  phase: "build",
  pid: 987654,
  startedAt: "2026-08-21T00:00:00.000Z",
};

const clock = new Date("2026-08-21T00:00:10.000Z");
async function temporaryStatusPath(): Promise<string> {
  const directory = await makeTempDir("threenative-gate-status-");
  return path.join(directory, "status.json");
}

function startInput(statusPath: string): IGateStatusStart {
  return {
    artifact: { identity: "run-1:build", path: statusPath },
    command: "pnpm run build",
    lease,
    owner: lease.owner,
    ownerPid: lease.pid,
    phase: "build",
    pid: lease.pid,
    runId: "run-1",
    statusPath,
    worktree,
  };
}

async function runningStatus(statusPath: string): Promise<IGateStatusRecord> {
  return startGatePhase(startInput(statusPath), { now: clock });
}

describe("gate status record", () => {
  it("records running, heartbeat, and terminal child results atomically", async () => {
    const statusPath = await temporaryStatusPath();
    const running = await runningStatus(statusPath);

    expect(running).toMatchObject({
      phase: "build",
      runId: "run-1",
      state: "running",
      terminalResult: null,
    });
    expect(JSON.parse(await readFile(statusPath, "utf8"))).toMatchObject({
      command: "pnpm run build",
      heartbeatAt: clock.toISOString(),
      lease: { expectedHead: worktree.head, path: worktree.path },
      pid: lease.pid,
    });

    const heartbeated = await heartbeatGatePhase(
      statusPath,
      { owner: lease.owner, ownerPid: lease.pid, phase: "build", pid: lease.pid, runId: "run-1" },
      { now: new Date("2026-08-21T00:00:20.000Z") },
    );
    expect(heartbeated.heartbeatAt).toBe("2026-08-21T00:00:20.000Z");

    const failed = await finishGatePhase(
      statusPath,
      {
        exitCode: 23,
        owner: lease.owner,
        ownerPid: lease.pid,
        phase: "build",
        pid: lease.pid,
        runId: "run-1",
      },
      { now: new Date("2026-08-21T00:00:21.000Z") },
    );
    expect(failed).toMatchObject({
      exitCode: 23,
      state: "failed",
      terminalResult: {
        exitCode: 23,
        state: "failed",
      },
    });
    expect((await readGateStatus(statusPath)).terminalResult?.exitCode).toBe(23);

    const files = await readdir(path.dirname(statusPath));
    expect(files.filter((file) => file.includes(".tmp"))).toHaveLength(0);
  });

  it("should reject a stale or malformed phase record", async () => {
    const statusPath = await temporaryStatusPath();
    await writeFile(statusPath, "{not-json\n", "utf8");
    await expect(readGateStatus(statusPath)).rejects.toThrow(
      "RED observed: invalid or stale gate status",
    );

    await runningStatus(statusPath);
    await expect(
      readGateStatus(statusPath, {
        currentWorktree: worktree,
        now: new Date("2026-08-21T00:01:00.000Z"),
      }),
    ).rejects.toThrow("RED observed: invalid or stale gate status");
  });

  it("rejects future heartbeats and owner-drifted worktrees", async () => {
    const statusPath = await temporaryStatusPath();
    await runningStatus(statusPath);

    await expect(
      readGateStatus(statusPath, {
        currentWorktree: { ...worktree, head: "2222222222222222222222222222222222222222" },
        now: new Date("2026-08-21T00:00:05.000Z"),
      }),
    ).rejects.toThrow(/RED observed: invalid or stale gate status.*HEAD/u);
  });
});
