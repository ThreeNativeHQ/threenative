import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
import { resumeGate, statusGate } from "../gate-cli.js";
import { type IGateStatusStart, finishGatePhase, startGatePhase } from "../gate-status.js";
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

async function fixture(): Promise<{ path: string; start: IGateStatusStart }> {
  const directory = await makeTempDir("threenative-gate-cli-");
  const statusPath = path.join(directory, "status.json");
  return {
    path: statusPath,
    start: {
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
    },
  };
}

async function failedFixture(): Promise<{ path: string; start: IGateStatusStart }> {
  const result = await fixture();
  await startGatePhase(result.start, { now: new Date("2026-08-21T00:00:00.000Z") });
  await finishGatePhase(
    result.path,
    {
      exitCode: 7,
      owner: lease.owner,
      ownerPid: lease.pid,
      phase: lease.phase,
      pid: lease.pid,
      runId: "run-1",
    },
    { now: new Date("2026-08-21T00:00:01.000Z") },
  );
  return result;
}

describe("gate status and resume CLI", () => {
  it("keeps status read-only and names the next diagnostic probe", async () => {
    const { path: statusPath, start } = await failedFixture();
    const before = await readFile(statusPath, "utf8");
    const output = await statusGate({
      currentWorktree: worktree,
      now: new Date("2026-08-21T00:00:02.000Z"),
      statusPath,
    });
    const after = await readFile(statusPath, "utf8");

    expect(after).toBe(before);
    expect(output).toContain(`phase: ${start.phase}`);
    expect(output).toContain("next probe:");
    expect(output).toContain("gate-cli.ts doctor");
  });

  it("should refuse resume after worktree HEAD drift", async () => {
    const { path: statusPath } = await failedFixture();
    let childStarted = false;

    await expect(
      resumeGate({
        currentWorktree: { ...worktree, head: "2222222222222222222222222222222222222222" },
        isOwnerAlive: () => false,
        runCommand: async () => {
          childStarted = true;
          return 0;
        },
        statusPath,
      }),
    ).rejects.toThrow("RED observed: resume refused for drifted worktree");
    expect(childStarted).toBe(false);
  });

  it("returns the exact child exit code after safe resume validation", async () => {
    const { path: statusPath } = await failedFixture();
    const childExitCode = await resumeGate({
      currentWorktree: worktree,
      isOwnerAlive: () => false,
      runCommand: async () => 19,
      statusPath,
    });

    expect(childExitCode).toBe(19);
  });
});
