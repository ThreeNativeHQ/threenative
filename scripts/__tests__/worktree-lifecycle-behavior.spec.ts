import { describe, expect, it } from "vitest";
import {
  type ILeaseRegistry,
  type IWorktreeRecord,
  assessWorktreeLease,
  canAcquireWorktreeLease,
  cleanupWorktreeLeases,
  heartbeatWorktreeLease,
  isWorktreeLeaseExpired,
  registerWorktreeLease,
  releaseWorktreeLease,
} from "../worktree-lifecycle.js";

const current: IWorktreeRecord = {
  branch: "refs/heads/test",
  head: "abc123",
  path: "/tmp/threenative-worktree",
};
const identity = { owner: "worker", pid: 1234 };
const empty: ILeaseRegistry = { leases: [], version: 1 };

describe("worktree lifecycle lease behavior", () => {
  it("registers, verifies, heartbeats, and releases one lease", () => {
    const started = "2026-08-23T00:00:00.000Z";
    const registered = registerWorktreeLease(empty, current, identity, "unit", started);
    const lease = registered.leases[0];
    if (lease === undefined) throw new Error("register did not create a lease");
    expect(assessWorktreeLease(lease, current, identity, Date.parse(started) + 1_000)).toEqual({
      ok: true,
    });

    const heartbeat = heartbeatWorktreeLease(
      registered,
      current,
      identity,
      "build",
      "2026-08-23T00:00:05.000Z",
    );
    expect(heartbeat.leases[0]).toMatchObject({
      heartbeatAt: "2026-08-23T00:00:05.000Z",
      phase: "build",
    });
    expect(releaseWorktreeLease(heartbeat, current.path, identity).leases).toEqual([]);
  });

  it("allows a dead owner's lease to be taken over", () => {
    const existing = registerWorktreeLease(
      empty,
      current,
      { owner: "dead", pid: 999 },
      "unit",
      "2026-08-23T00:00:00.000Z",
    );
    const assessment = canAcquireWorktreeLease(
      existing.leases[0],
      identity,
      () => false,
      Date.parse("2026-08-23T00:00:01.000Z"),
    );
    expect(assessment).toMatchObject({ ok: true });
    expect(assessment.reason).toMatch(/stale lease/u);
  });

  it("takes over an expired lease even when its PID is still alive", () => {
    const old = {
      heartbeatAt: "2026-08-23T00:00:00.000Z",
      startedAt: "2026-08-23T00:00:00.000Z",
    };
    expect(
      isWorktreeLeaseExpired(old, Date.parse("2026-08-23T00:16:00.000Z"), 15 * 60 * 1_000),
    ).toBe(true);
    const lease = registerWorktreeLease(
      empty,
      current,
      { owner: "hung", pid: 999 },
      "unit",
      old.startedAt,
    );
    const assessment = canAcquireWorktreeLease(
      lease.leases[0],
      identity,
      () => true,
      Date.parse("2026-08-23T00:16:00.000Z"),
      15 * 60 * 1_000,
    );
    expect(assessment).toMatchObject({ ok: true });
    expect(assessment.reason).toMatch(/expired lease/u);
  });

  it("removes an expired lease even when its PID is still alive", () => {
    const now = Date.parse("2026-08-23T00:16:00.000Z");
    const expiredLease = registerWorktreeLease(
      empty,
      current,
      { owner: "hung", pid: 999 },
      "unit",
      "2026-08-23T00:00:00.000Z",
    ).leases[0];
    const activeLease = registerWorktreeLease(
      empty,
      { ...current, head: "def456", path: "/tmp/active-worktree" },
      { owner: "active", pid: 1000 },
      "unit",
      "2026-08-23T00:15:00.000Z",
    ).leases[0];
    if (expiredLease === undefined || activeLease === undefined)
      throw new Error("register did not create cleanup fixtures");

    const result = cleanupWorktreeLeases(
      { leases: [expiredLease, activeLease], version: 1 },
      () => true,
      now,
    );

    expect(result.removed).toBe(1);
    expect(result.registry.leases).toEqual([activeLease]);
  });

  it("rejects a wrong owner and an expired heartbeat during verification", () => {
    const lease = registerWorktreeLease(
      empty,
      current,
      identity,
      "unit",
      "2026-08-23T00:00:00.000Z",
    ).leases[0];
    if (lease === undefined) throw new Error("register did not create a lease");
    expect(() =>
      releaseWorktreeLease({ leases: [lease], version: 1 }, current.path, {
        owner: "other",
        pid: 55,
      }),
    ).toThrow(/TN_WORKTREE_OWNED/u);
    expect(
      assessWorktreeLease(lease, current, identity, Date.parse("2026-08-23T00:16:00.000Z")),
    ).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/heartbeat expired/u),
    });
  });
});
