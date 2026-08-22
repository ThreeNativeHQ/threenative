import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const REGISTRY_VERSION = 1;
const LOCK_WAIT_MS = 50;
const LOCK_ATTEMPTS = 100;

export interface IWorktreeRecord {
  branch: string | undefined;
  head: string;
  path: string;
}

export interface IWorktreeLease {
  branch: string | undefined;
  expectedHead: string;
  heartbeatAt?: string;
  owner: string;
  path: string;
  phase: string;
  pid: number;
  runId?: string;
  startedAt: string;
}

export interface ILeaseIdentity {
  owner: string;
  pid: number;
}

export interface ILeaseAssessment {
  ok: boolean;
  reason?: string;
}

export interface IWorktreeContext {
  current: IWorktreeRecord;
  records: IWorktreeRecord[];
  registryPath: string;
  repositoryRoot: string;
}

interface ILeaseRegistry {
  leases: IWorktreeLease[];
  version: number;
}

interface IArguments {
  command: "cleanup" | "heartbeat" | "register" | "release" | "status" | "verify";
  confirm: boolean;
  owner: string;
  phase: string;
  pid: number;
  requireLease: boolean;
  runId: string | undefined;
}

interface IArgumentState {
  confirm: boolean;
  owner: string;
  phase: string;
  pid: number;
  requireLease: boolean;
  runId: string | undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new Error(`TN_WORKTREE_REGISTRY_INVALID: ${name} is invalid.`);
  return value;
}

function parseLease(value: unknown): IWorktreeLease {
  if (!isObject(value)) throw new Error("TN_WORKTREE_REGISTRY_INVALID: a lease is invalid.");
  const branch = optionalString(value.branch, "branch");
  const expectedHead = value.expectedHead;
  const heartbeatAt = optionalString(value.heartbeatAt, "heartbeatAt");
  const owner = value.owner;
  const leasePath = value.path;
  const phase = value.phase;
  const pid = value.pid;
  const runId = optionalString(value.runId, "runId");
  const startedAt = value.startedAt;
  const parsedPid = typeof pid === "number" ? pid : undefined;
  if (
    typeof expectedHead !== "string" ||
    typeof owner !== "string" ||
    typeof leasePath !== "string" ||
    typeof phase !== "string" ||
    parsedPid === undefined ||
    !Number.isInteger(parsedPid) ||
    parsedPid <= 0 ||
    typeof startedAt !== "string" ||
    owner.length === 0 ||
    leasePath.length === 0 ||
    phase.length === 0
  ) {
    throw new Error("TN_WORKTREE_REGISTRY_INVALID: a lease is invalid.");
  }
  return {
    branch,
    expectedHead,
    ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
    owner,
    path: leasePath,
    phase,
    pid: parsedPid,
    ...(runId === undefined ? {} : { runId }),
    startedAt,
  };
}

export function parseWorktreeList(output: string): IWorktreeRecord[] {
  const records: IWorktreeRecord[] = [];
  let current: Partial<IWorktreeRecord> = {};
  const flush = (): void => {
    if (current.path === undefined && current.head === undefined) {
      current = {};
      return;
    }
    if (current.path === undefined || current.head === undefined) {
      throw new Error("TN_WORKTREE_LIST_INVALID: a worktree record is missing its path or HEAD.");
    }
    records.push({ branch: current.branch, head: current.head, path: current.path });
    current = {};
  };

  for (const line of output.split("\n")) {
    if (line.trim().length === 0) {
      flush();
    } else if (line.startsWith("worktree ")) {
      if (current.path !== undefined || current.head !== undefined) flush();
      current.path = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }
  flush();
  return records;
}

export function assessWorktreeSnapshot(
  expected: IWorktreeRecord,
  current: IWorktreeRecord,
): ILeaseAssessment {
  if (path.resolve(expected.path) !== path.resolve(current.path)) {
    return {
      ok: false,
      reason: `worktree path changed from '${expected.path}' to '${current.path}'`,
    };
  }
  if (expected.head !== current.head) {
    return {
      ok: false,
      reason: `worktree HEAD changed from ${expected.head} to ${current.head}`,
    };
  }
  if (expected.branch !== current.branch) {
    return {
      ok: false,
      reason: `worktree branch changed from '${expected.branch ?? "detached"}' to '${current.branch ?? "detached"}'`,
    };
  }
  return { ok: true };
}

export function worktreeFromLease(
  lease: Pick<IWorktreeLease, "branch" | "expectedHead" | "path">,
): IWorktreeRecord {
  return { branch: lease.branch, head: lease.expectedHead, path: lease.path };
}

export function assessWorktreeLease(
  lease: IWorktreeLease,
  current: IWorktreeRecord,
  identity: ILeaseIdentity,
): ILeaseAssessment {
  const snapshot = assessWorktreeSnapshot(worktreeFromLease(lease), current);
  if (!snapshot.ok) return snapshot;
  if (lease.owner !== identity.owner || lease.pid !== identity.pid) {
    return {
      ok: false,
      reason: `worktree is owned by ${lease.owner} (pid ${lease.pid})`,
    };
  }
  return { ok: true };
}

export function canAcquireWorktreeLease(
  existing: IWorktreeLease | undefined,
  requested: ILeaseIdentity,
  processIsAlive: (pid: number) => boolean,
): ILeaseAssessment {
  if (existing === undefined) return { ok: true };
  if (existing.owner === requested.owner && existing.pid === requested.pid) return { ok: true };
  if (processIsAlive(existing.pid)) {
    return {
      ok: false,
      reason: `worktree is already owned by ${existing.owner} (pid ${existing.pid})`,
    };
  }
  return {
    ok: true,
    reason: `replacing stale lease owned by ${existing.owner} (pid ${existing.pid})`,
  };
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EPERM"
    );
  }
}

function runGit(repositoryRoot: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

function repositoryContext(): { commonDirectory: string; repositoryRoot: string } {
  const repositoryRoot = runGit(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const commonDirectoryValue = runGit(repositoryRoot, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = path.isAbsolute(commonDirectoryValue)
    ? commonDirectoryValue
    : path.resolve(repositoryRoot, commonDirectoryValue);
  return { commonDirectory, repositoryRoot };
}

export async function readWorktreeContext(): Promise<IWorktreeContext> {
  const { commonDirectory, repositoryRoot } = repositoryContext();
  const records = parseWorktreeList(runGit(repositoryRoot, ["worktree", "list", "--porcelain"]));
  const currentPath = path.resolve(repositoryRoot);
  const current = records.find((record) => path.resolve(record.path) === currentPath);
  if (current === undefined) {
    throw new Error(
      `TN_WORKTREE_UNREGISTERED: Git does not list the current checkout '${currentPath}'.`,
    );
  }
  return {
    current,
    records,
    registryPath: path.join(commonDirectory, "threenative-worktree-leases.json"),
    repositoryRoot,
  };
}

export async function readLeaseRegistry(registryPath: string): Promise<ILeaseRegistry> {
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8")) as unknown;
    if (!isObject(parsed) || parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.leases)) {
      throw new Error();
    }
    return {
      leases: parsed.leases.map(parseLease),
      version: REGISTRY_VERSION,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { leases: [], version: REGISTRY_VERSION };
    }
    if (error instanceof Error && error.message.startsWith("TN_WORKTREE_REGISTRY_INVALID")) {
      throw error;
    }
    throw new Error(`TN_WORKTREE_REGISTRY_INVALID: cannot read ${registryPath}.`);
  }
}

async function writeRegistry(registryPath: string, registry: ILeaseRegistry): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true });
  const temporaryPath = `${registryPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(temporaryPath, registryPath);
}

async function withRegistryLock<T>(registryPath: string, action: () => Promise<T>): Promise<T> {
  const lockPath = `${registryPath}.lock`;
  let locked = false;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath);
      await writeFile(path.join(lockPath, "owner"), `${process.pid}\n`, "utf8");
      locked = true;
      break;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error as NodeJS.ErrnoException).code !== "EEXIST"
      ) {
        throw error;
      }
      try {
        const owner = Number.parseInt(await readFile(path.join(lockPath, "owner"), "utf8"), 10);
        if (!processIsAlive(owner)) await rm(lockPath, { force: true, recursive: true });
      } catch {
        // The owner file can be between mkdir and writeFile. The next attempt observes it.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, LOCK_WAIT_MS));
    }
  }
  if (!locked) {
    throw new Error(
      "TN_WORKTREE_LOCK_TIMEOUT: another lifecycle operation held the registry lock for 5 seconds.",
    );
  }
  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true, recursive: true });
  }
}

function defaultOwner(): string {
  return `${process.env.USER ?? "unknown"}@${os.hostname()}`;
}

export function findWorktreeLease(
  records: readonly IWorktreeLease[],
  currentPath: string,
): IWorktreeLease | undefined {
  return records.find((lease) => path.resolve(lease.path) === path.resolve(currentPath));
}

export async function getCurrentWorktreeLease(): Promise<{
  context: IWorktreeContext;
  lease: IWorktreeLease | undefined;
}> {
  const context = await readWorktreeContext();
  const registry = await readLeaseRegistry(context.registryPath);
  return { context, lease: findWorktreeLease(registry.leases, context.current.path) };
}

export async function verifyCurrentWorktreeLease(
  identity: ILeaseIdentity,
  options: { phase?: string; requireLease?: boolean } = {},
): Promise<{ context: IWorktreeContext; lease: IWorktreeLease | undefined }> {
  const { context, lease } = await getCurrentWorktreeLease();
  if (lease === undefined) {
    if (options.requireLease === false) return { context, lease: undefined };
    throw new Error(
      `TN_WORKTREE_LEASE_MISSING: register this checkout before phase '${options.phase ?? "manual"}'.`,
    );
  }
  const assessment = assessWorktreeLease(lease, context.current, identity);
  if (!assessment.ok) {
    throw new Error(
      `TN_WORKTREE_GUARD_FAILED: phase '${options.phase ?? lease.phase}' — ${assessment.reason}`,
    );
  }
  return { context, lease };
}

function statusFor(record: IWorktreeRecord, lease: IWorktreeLease | undefined): string {
  if (lease === undefined) return "unleased";
  if (!existsSync(record.path)) return "missing-path";
  if (!processIsAlive(lease.pid)) return "stale-lease";
  return assessWorktreeSnapshot(worktreeFromLease(lease), record).ok ? "owned" : "drifted";
}

async function printStatus(): Promise<void> {
  const context = await readWorktreeContext();
  const registry = await readLeaseRegistry(context.registryPath);
  const knownPaths = new Set(
    context.records.map(({ path: recordPath }) => path.resolve(recordPath)),
  );
  process.stdout.write("worktree status (read-only)\n");
  for (const record of context.records) {
    const lease = findWorktreeLease(registry.leases, record.path);
    const owner = lease === undefined ? "-" : `${lease.owner}/pid:${lease.pid}/${lease.phase}`;
    process.stdout.write(`${statusFor(record, lease)}\t${record.path}\t${record.head}\t${owner}\n`);
  }
  for (const lease of registry.leases) {
    if (!knownPaths.has(path.resolve(lease.path))) {
      process.stdout.write(
        `orphaned-lease\t${lease.path}\t${lease.expectedHead}\t${lease.owner}/pid:${lease.pid}/${lease.phase}\n`,
      );
    }
  }
}

async function registerLease(args: IArguments): Promise<void> {
  const context = await readWorktreeContext();
  const identity = { owner: args.owner, pid: args.pid };
  const now = new Date().toISOString();
  await withRegistryLock(context.registryPath, async () => {
    const registry = await readLeaseRegistry(context.registryPath);
    const existing = findWorktreeLease(registry.leases, context.current.path);
    const acquisition = canAcquireWorktreeLease(existing, identity, processIsAlive);
    if (!acquisition.ok) throw new Error(`TN_WORKTREE_OWNED: ${acquisition.reason}`);
    if (
      existing !== undefined &&
      existing.owner === identity.owner &&
      existing.pid === identity.pid
    ) {
      const assessment = assessWorktreeLease(existing, context.current, identity);
      if (!assessment.ok) throw new Error(`TN_WORKTREE_DRIFTED: ${assessment.reason}`);
    }
    const next: IWorktreeLease = {
      branch: context.current.branch,
      expectedHead: context.current.head,
      heartbeatAt: now,
      owner: identity.owner,
      path: context.current.path,
      phase: args.phase,
      pid: identity.pid,
      ...(args.runId === undefined ? {} : { runId: args.runId }),
      startedAt: existing?.startedAt ?? now,
    };
    await writeRegistry(context.registryPath, {
      leases: [
        ...registry.leases.filter(
          (lease) => path.resolve(lease.path) !== path.resolve(context.current.path),
        ),
        next,
      ],
      version: REGISTRY_VERSION,
    });
  });
  process.stdout.write(`worktree lease registered: ${context.current.path} (${args.phase})\n`);
}

async function verifyLease(args: IArguments): Promise<void> {
  const { context, lease } = await verifyCurrentWorktreeLease(
    { owner: args.owner, pid: args.pid },
    { phase: args.phase, requireLease: args.requireLease },
  );
  if (lease === undefined) {
    process.stdout.write(`worktree is unleased: ${context.current.path}\n`);
    return;
  }
  process.stdout.write(
    `worktree verified: ${context.current.path} (${args.phase}, ${context.current.head})\n`,
  );
}

async function heartbeatLease(args: IArguments): Promise<void> {
  const context = await readWorktreeContext();
  await withRegistryLock(context.registryPath, async () => {
    const registry = await readLeaseRegistry(context.registryPath);
    const existing = findWorktreeLease(registry.leases, context.current.path);
    if (existing === undefined) {
      throw new Error(`TN_WORKTREE_LEASE_MISSING: cannot heartbeat '${args.phase}'.`);
    }
    const assessment = assessWorktreeLease(existing, context.current, {
      owner: args.owner,
      pid: args.pid,
    });
    if (!assessment.ok) {
      throw new Error(`TN_WORKTREE_GUARD_FAILED: phase '${args.phase}' — ${assessment.reason}`);
    }
    const next: IWorktreeLease = {
      ...existing,
      heartbeatAt: new Date().toISOString(),
      phase: args.phase === "manual" ? existing.phase : args.phase,
      ...(args.runId === undefined ? {} : { runId: args.runId }),
    };
    await writeRegistry(context.registryPath, {
      leases: registry.leases.map((lease) =>
        path.resolve(lease.path) === path.resolve(context.current.path) ? next : lease,
      ),
      version: REGISTRY_VERSION,
    });
  });
}

async function releaseLease(args: IArguments): Promise<void> {
  const context = await readWorktreeContext();
  await withRegistryLock(context.registryPath, async () => {
    const registry = await readLeaseRegistry(context.registryPath);
    const lease = findWorktreeLease(registry.leases, context.current.path);
    if (lease === undefined) return;
    if (lease.owner !== args.owner || lease.pid !== args.pid) {
      throw new Error(`TN_WORKTREE_OWNED: cannot release ${lease.owner} (pid ${lease.pid}) lease.`);
    }
    await writeRegistry(context.registryPath, {
      leases: registry.leases.filter(
        (candidate) => path.resolve(candidate.path) !== path.resolve(context.current.path),
      ),
      version: REGISTRY_VERSION,
    });
  });
  process.stdout.write(`worktree lease released: ${context.current.path}\n`);
}

async function cleanupLeases(args: IArguments): Promise<void> {
  const context = await readWorktreeContext();
  const cleanup = async (): Promise<number> => {
    const registry = await readLeaseRegistry(context.registryPath);
    const stale = registry.leases.filter((lease) => !processIsAlive(lease.pid));
    if (!args.confirm) {
      process.stdout.write(
        stale.length === 0
          ? "no stale worktree leases; no worktrees changed\n"
          : `would remove ${stale.length} stale lease record(s); pass --confirm to remove records only\n`,
      );
      return 0;
    }
    if (stale.length > 0) {
      await writeRegistry(context.registryPath, {
        leases: registry.leases.filter((lease) => processIsAlive(lease.pid)),
        version: REGISTRY_VERSION,
      });
    }
    process.stdout.write(`removed ${stale.length} stale lease record(s); no worktrees changed\n`);
    return 0;
  };
  await withRegistryLock(context.registryPath, cleanup);
}

function parseFlag(flags: readonly string[], index: number, state: IArgumentState): number {
  const flag = flags[index];
  if (flag === "--confirm") {
    state.confirm = true;
    return index + 1;
  }
  if (flag === "--no-require-lease") {
    state.requireLease = false;
    return index + 1;
  }
  const value = flags[index + 1] ?? "";
  if (flag === "--owner") state.owner = value;
  else if (flag === "--phase") state.phase = value;
  else if (flag === "--pid") state.pid = Number.parseInt(value, 10);
  else if (flag === "--run-id") state.runId = value;
  else throw new Error(`unknown worktree lifecycle option '${flag}'`);
  return index + 2;
}

function parseArguments(argv: readonly string[]): IArguments {
  const [commandValue = "status", ...flags] = argv;
  if (!["cleanup", "heartbeat", "register", "release", "status", "verify"].includes(commandValue)) {
    throw new Error(
      "usage: worktree-lifecycle.ts <status|register|verify|heartbeat|release|cleanup> [options]",
    );
  }
  const state: IArgumentState = {
    confirm: false,
    owner: defaultOwner(),
    phase: "manual",
    pid: process.pid,
    requireLease: true,
    runId: undefined,
  };
  for (let index = 0; index < flags.length; index = parseFlag(flags, index, state)) {
    // The flag parser advances the index and validates its value.
  }
  if (!state.owner || !state.phase || !Number.isInteger(state.pid) || state.pid <= 0) {
    throw new Error(
      "TN_WORKTREE_CLI_USAGE: --owner, --phase, and --pid must be non-empty and valid.",
    );
  }
  return {
    command: commandValue as IArguments["command"],
    confirm: state.confirm,
    owner: state.owner,
    phase: state.phase,
    pid: state.pid,
    requireLease: state.requireLease,
    runId: state.runId,
  };
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  if (args.command === "status") return printStatus();
  if (args.command === "register") return registerLease(args);
  if (args.command === "verify") return verifyLease(args);
  if (args.command === "heartbeat") return heartbeatLease(args);
  if (args.command === "release") return releaseLease(args);
  return cleanupLeases(args);
}

if (process.argv[1]?.endsWith("worktree-lifecycle.ts") === true) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
