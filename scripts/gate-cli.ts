import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_GATE_STATUS_PATH,
  GateStatusError,
  type IGateStatusRecord,
  isGateStatusStale,
  readGateStatus,
} from "./gate-status.js";
import {
  type IWorktreeLease,
  type IWorktreeRecord,
  assessWorktreeSnapshot,
  getCurrentWorktreeLease,
  processIsAlive,
  readWorktreeContext,
  worktreeFromLease,
} from "./worktree-lifecycle.js";

export interface IStatusGateOptions {
  currentWorktree?: IWorktreeRecord;
  isOwnerAlive?: (pid: number) => boolean;
  now?: Date;
  statusPath: string;
}

export interface IResumeGateOptions {
  currentLease?: IWorktreeLease;
  currentWorktree?: IWorktreeRecord;
  isOwnerAlive?: (pid: number) => boolean;
  now?: Date;
  runCommand?: (record: IGateStatusRecord, statusPath: string) => Promise<number>;
  statusPath: string;
  verifyLease?: boolean;
}

export class GateResumeError extends Error {
  readonly code = "TN_GATE_RESUME_REFUSED";

  constructor(reason: string, driftedWorktree = false) {
    super(
      driftedWorktree
        ? `RED observed: resume refused for drifted worktree — ${reason}`
        : `RED observed: resume refused — ${reason}`,
    );
    this.name = "GateResumeError";
  }
}

function nextProbe(statusPath: string, action: "doctor" | "resume" | "status"): string {
  return `pnpm exec tsx scripts/gate-cli.ts ${action} --status-path ${statusPath}`;
}

function resolveStatusPath(statusPath: string): string {
  return path.resolve(statusPath);
}

function currentContext(options: { currentWorktree?: IWorktreeRecord }): Promise<IWorktreeRecord> {
  if (options.currentWorktree !== undefined) return Promise.resolve(options.currentWorktree);
  return readWorktreeContext().then(({ current }) => current);
}

function formatStatus(record: IGateStatusRecord): string {
  const terminal =
    record.terminalResult === null
      ? "none"
      : `${record.terminalResult.state} (exit ${record.terminalResult.exitCode})`;
  const probe = nextProbe(record.statusPath, "doctor");
  return [
    "gate status (read-only)",
    `run: ${record.runId}`,
    `phase: ${record.phase}`,
    `state: ${record.state}`,
    `heartbeat: ${record.heartbeatAt}`,
    `owner: ${record.owner}/pid:${record.ownerPid}`,
    `phase pid: ${record.pid}`,
    `command: ${record.command}`,
    `worktree: ${record.worktree.path}`,
    `HEAD: ${record.worktree.head}`,
    `artifact: ${record.artifact.path} (${record.artifact.identity})`,
    `terminal result: ${terminal}`,
    `next probe: ${probe}`,
    "",
  ].join("\n");
}

export async function statusGate(options: IStatusGateOptions): Promise<string> {
  const current = await currentContext(options);
  const record = await readGateStatus(resolveStatusPath(options.statusPath), {
    currentWorktree: current,
    isOwnerAlive: options.isOwnerAlive ?? processIsAlive,
    now: options.now,
  });
  if (record.state === "running" && options.currentWorktree === undefined) {
    const { lease } = await getCurrentWorktreeLease();
    if (lease === undefined) throw new GateStatusError("running phase has no live lease");
    const snapshot = assessWorktreeSnapshot(
      worktreeFromLease(record.lease),
      worktreeFromLease(lease),
    );
    if (!snapshot.ok || record.lease.owner !== lease.owner || record.lease.pid !== lease.pid) {
      throw new GateStatusError(snapshot.reason ?? "running phase lease ownership changed");
    }
  }
  return formatStatus(record);
}

function assessResumeRecord(
  record: IGateStatusRecord,
  current: IWorktreeRecord,
  statusPath: string,
  options: Pick<IResumeGateOptions, "isOwnerAlive" | "now">,
): void {
  const snapshot = assessWorktreeSnapshot(record.worktree, current);
  if (!snapshot.ok) throw new GateResumeError(snapshot.reason ?? "worktree identity changed", true);
  const leaseSnapshot = assessWorktreeSnapshot(worktreeFromLease(record.lease), current);
  if (!leaseSnapshot.ok) {
    throw new GateResumeError(leaseSnapshot.reason ?? "lease identity changed", true);
  }
  if (path.resolve(record.statusPath) !== path.resolve(statusPath)) {
    throw new GateResumeError("status artifact path changed", true);
  }
  if (!isGateStatusStale(record, { isOwnerAlive: options.isOwnerAlive, now: options.now })) {
    if (record.state === "running") throw new GateResumeError("phase owner is still active");
  }
  if (record.state === "succeeded")
    throw new GateResumeError("a succeeded phase cannot be resumed");
}

async function validateArtifactIdentity(record: IGateStatusRecord): Promise<void> {
  if (record.artifact.sha256 === undefined) {
    try {
      await readFile(record.artifact.path);
    } catch {
      throw new GateResumeError(`artifact '${record.artifact.path}' is missing`);
    }
    return;
  }
  let content: Buffer;
  try {
    content = await readFile(record.artifact.path);
  } catch {
    throw new GateResumeError(`artifact '${record.artifact.path}' is missing`);
  }
  const actual = createHash("sha256").update(content).digest("hex");
  if (actual !== record.artifact.sha256) {
    throw new GateResumeError(`artifact '${record.artifact.path}' identity changed`);
  }
}

async function verifyCurrentLease(
  record: IGateStatusRecord,
  current: IWorktreeRecord,
  suppliedLease: IWorktreeLease | undefined,
): Promise<void> {
  const lease = suppliedLease ?? (await getCurrentWorktreeLease()).lease;
  if (lease === undefined) throw new GateResumeError("verified worktree lease is missing");
  const snapshot = assessWorktreeSnapshot(
    worktreeFromLease(record.lease),
    worktreeFromLease(lease),
  );
  if (!snapshot.ok || lease.owner !== record.lease.owner || lease.pid !== record.lease.pid) {
    throw new GateResumeError(snapshot.reason ?? "worktree lease identity changed", true);
  }
  const currentSnapshot = assessWorktreeSnapshot(worktreeFromLease(lease), current);
  if (!currentSnapshot.ok)
    throw new GateResumeError(currentSnapshot.reason ?? "worktree drifted", true);
}

function spawnResume(record: IGateStatusRecord, statusPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "bash",
      [
        path.resolve(process.cwd(), "scripts/run-test-suite.sh"),
        "--resume",
        "--status-path",
        statusPath,
        "--run-id",
        record.runId,
        "--phase",
        record.phase,
      ],
      { cwd: process.cwd(), stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

export async function resumeGate(options: IResumeGateOptions): Promise<number> {
  const statusPath = resolveStatusPath(options.statusPath);
  const current = await currentContext(options);
  const record = await readGateStatus(statusPath, {
    allowStale: true,
    isOwnerAlive: options.isOwnerAlive ?? processIsAlive,
    now: options.now,
  });
  assessResumeRecord(record, current, statusPath, options);
  await validateArtifactIdentity(record);
  if (options.verifyLease !== false && options.currentWorktree === undefined) {
    await verifyCurrentLease(record, current, options.currentLease);
  }
  const runCommand = options.runCommand ?? spawnResume;
  return runCommand(record, statusPath);
}

export async function doctorGate(options: IStatusGateOptions): Promise<string> {
  const current = await currentContext(options);
  try {
    const record = await readGateStatus(resolveStatusPath(options.statusPath), {
      allowStale: true,
      currentWorktree: current,
      isOwnerAlive: options.isOwnerAlive ?? processIsAlive,
      now: options.now,
    });
    const stale = isGateStatusStale(record, {
      isOwnerAlive: options.isOwnerAlive ?? processIsAlive,
      now: options.now,
    });
    const action = stale || record.state === "failed" ? "resume" : "status";
    return [
      "gate doctor (read-only)",
      `run: ${record.runId}`,
      `phase: ${record.phase}`,
      `state: ${stale ? "stale" : record.state}`,
      `heartbeat: ${record.heartbeatAt}`,
      `next probe: ${nextProbe(record.statusPath, action)}`,
      "",
    ].join("\n");
  } catch (error) {
    if (error instanceof GateStatusError) {
      return [
        "gate doctor (read-only)",
        `status: blocked — ${error.message}`,
        `next probe: ${nextProbe(resolveStatusPath(options.statusPath), "status")}`,
        "",
      ].join("\n");
    }
    throw error;
  }
}

function flagValue(flags: readonly string[], name: string): string | undefined {
  const index = flags.indexOf(name);
  return index < 0 ? undefined : flags[index + 1];
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command = "status", ...flags] = argv;
  const statusPath = flagValue(flags, "--status-path") ?? DEFAULT_GATE_STATUS_PATH;
  if (command === "status") {
    process.stdout.write(await statusGate({ statusPath }));
    return 0;
  }
  if (command === "doctor") {
    process.stdout.write(await doctorGate({ statusPath }));
    return 0;
  }
  if (command === "resume") return resumeGate({ statusPath });
  throw new Error("usage: gate-cli.ts <status|resume|doctor> [--status-path path]");
}

if (process.argv[1]?.endsWith("gate-cli.ts") === true) {
  main()
    .then((exitCode) => {
      if (exitCode !== 0) process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
