// Shared writer for the one read-only local gate record. Extracted from the record shape
// scripts/run-test-suite.sh already wrote through gate-status.ts, so every long chain —
// parity, visuals, sweeps, profiling — answers `pnpm gate:status` identically: run, phase,
// heartbeat, owner, command, artifact. This module only emits; reading, validation and
// staleness stay in gate-status.ts, which remains the shape's enforcer. Like the reader,
// misuse throws: heartbeating or finishing an unknown, foreign or terminal record fails.
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GATE_RECORDS_HEARTBEAT_INTERVAL_MS = 10_000;

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`gate-records: ${name} is missing or invalid`);
  }
  return value;
}

function requirePid(value) {
  if (!Number.isInteger(value) || value <= 0) throw new Error("gate-records: invalid pid");
  return value;
}

export function defaultRunId(now = new Date()) {
  return `tn-${now.toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}`;
}

export function defaultOwner() {
  return process.env.TN_WORKTREE_OWNER ?? `${process.env.USER ?? "unknown"}@${hostname()}`;
}

// The suite honours this env when it passes --status-path; chains honour it here so a
// bogus-path negative control can prove the record comes from the writer, not from disk.
export function defaultStatusPath(repoRoot = path.resolve(import.meta.dirname, "..")) {
  return process.env.TN_GATE_STATUS_PATH ?? path.resolve(repoRoot, "artifacts/gates/status.json");
}

async function gitSnapshot(repoRoot) {
  const options = { cwd: repoRoot };
  const head = (await execFileAsync("git", ["rev-parse", "HEAD"], options)).stdout.trim();
  if (!/^[0-9a-f]{40}$/u.test(head)) {
    throw new Error(`gate-records: could not resolve HEAD in ${repoRoot}`);
  }
  // A detached head has no symbolic branch; the field stays optional.
  const branch = await execFileAsync("git", ["symbolic-ref", "-q", "HEAD"], options)
    .then((result) => result.stdout.trim() || undefined)
    .catch(() => undefined);
  return { branch, head };
}

async function writeAtomic(statusPath, record) {
  const resolvedPath = path.resolve(statusPath);
  const temporaryPath = `${resolvedPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await rename(temporaryPath, resolvedPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readOwnedRunningRecord(statusPath, identity) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.resolve(statusPath), "utf8"));
  } catch {
    throw new Error(
      `gate-records: status file '${path.resolve(statusPath)}' is missing or not valid JSON`,
    );
  }
  if (
    parsed.runId !== identity.runId ||
    parsed.phase !== identity.phase ||
    parsed.owner !== identity.owner ||
    parsed.pid !== identity.pid
  ) {
    throw new Error("gate-records: phase owner or run identity changed");
  }
  if (parsed.state !== "running") throw new Error("gate-records: phase is already terminal");
  if (path.resolve(parsed.statusPath) !== path.resolve(statusPath)) {
    throw new Error("gate-records: status artifact path changed");
  }
  return parsed;
}

export async function startGateRecord({
  command,
  now = () => new Date(),
  owner = defaultOwner(),
  phase,
  pid = process.pid,
  repoRoot = path.resolve(import.meta.dirname, ".."),
  runId = defaultRunId(),
  statusPath = defaultStatusPath(repoRoot),
}) {
  requiredString(command, "command");
  requiredString(phase, "phase");
  requiredString(runId, "runId");
  requiredString(owner, "owner");
  requirePid(pid);
  const timestamp = now().toISOString();
  const resolvedStatusPath = path.resolve(statusPath);
  const worktree = await gitSnapshot(repoRoot);
  await writeAtomic(resolvedStatusPath, {
    artifact: { identity: `${runId}:${phase}`, path: resolvedStatusPath },
    command,
    exitCode: null,
    finishedAt: null,
    heartbeatAt: timestamp,
    lease: {
      ...(worktree.branch === undefined ? {} : { branch: worktree.branch }),
      expectedHead: worktree.head,
      owner,
      path: repoRoot,
      phase,
      pid,
      runId,
      startedAt: timestamp,
    },
    owner,
    ownerPid: pid,
    phase,
    pid,
    runId,
    schemaVersion: 1,
    startedAt: timestamp,
    state: "running",
    statusPath: resolvedStatusPath,
    terminalResult: null,
    // The reader validates lease-against-worktree; path is required alongside head.
    worktree: { ...worktree, path: repoRoot },
  });
}

export async function heartbeatGateRecord({
  now = () => new Date(),
  owner = defaultOwner(),
  phase,
  pid = process.pid,
  runId,
  statusPath,
}) {
  requiredString(runId, "runId");
  requiredString(phase, "phase");
  requiredString(owner, "owner");
  requirePid(pid);
  const record = await readOwnedRunningRecord(statusPath, { owner, phase, pid, runId });
  await writeAtomic(path.resolve(statusPath), {
    ...record,
    heartbeatAt: now().toISOString(),
  });
}

export async function finishGateRecord({
  exitCode,
  now = () => new Date(),
  owner = defaultOwner(),
  phase,
  pid = process.pid,
  runId,
  statusPath,
}) {
  requiredString(runId, "runId");
  requiredString(phase, "phase");
  requiredString(owner, "owner");
  requirePid(pid);
  if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    throw new Error(`gate-records: invalid exit code ${String(exitCode)}`);
  }
  const record = await readOwnedRunningRecord(statusPath, { owner, phase, pid, runId });
  const timestamp = now().toISOString();
  const state = exitCode === 0 ? "succeeded" : "failed";
  await writeAtomic(path.resolve(statusPath), {
    ...record,
    exitCode,
    finishedAt: timestamp,
    heartbeatAt: timestamp,
    state,
    terminalResult: { exitCode, finishedAt: timestamp, state },
  });
}

/**
 * Convenience wrapper for in-process chains: writes the running record, registers the
 * matching worktree-lifecycle lease (`gate:status` cross-checks running records against the
 * live registry, exactly as it does for the test suite), keeps both heartbeats fresh from a
 * dedicated detached helper process — a chain that blocks its own event loop with
 * `spawnSync` (the conformance lane loop) would starve an in-process timer — and finishes
 * terminally exactly once.
 */
export async function createGateRecorder(options) {
  // Defaults are resolved here, not only inside startGateRecord, because the lifecycle
  // lease must carry the same owner/pid/run-id the record carries.
  const repoRoot = path.resolve(options.repoRoot ?? path.join(import.meta.dirname, ".."));
  const merged = {
    command: "",
    ...options,
    owner: options.owner ?? defaultOwner(),
    pid: options.pid ?? process.pid,
    runId: options.runId ?? defaultRunId(),
    repoRoot,
    statusPath: options.statusPath ?? defaultStatusPath(repoRoot),
  };
  // Absolute everywhere: a chain that moved its own cwd must not break the lease spawn.
  const lifecycleScript = path.join(repoRoot, "scripts", "worktree-lifecycle.ts");
  const lifecycleArgs = [
    "--phase",
    merged.phase,
    "--owner",
    merged.owner,
    "--pid",
    String(merged.pid),
  ];
  const lifecycle = (action, withRunId) =>
    execFileAsync(
      "pnpm",
      [
        "exec",
        "tsx",
        lifecycleScript,
        action,
        ...lifecycleArgs,
        ...(withRunId ? ["--run-id", merged.runId] : []),
      ],
      { cwd: repoRoot },
    );

  await lifecycle("register", true);
  await startGateRecord(merged);
  // The helper heartbeats both the record and the lease from its own event loop, and exits
  // by itself once the record turns terminal or the owning process dies.
  const helper = spawn(
    process.execPath,
    [
      path.join(repoRoot, "scripts", "gate-records.mjs"),
      "heartbeat-loop",
      "--status-path",
      merged.statusPath,
      "--run-id",
      merged.runId,
      "--phase",
      merged.phase,
      "--owner",
      merged.owner,
      "--pid",
      String(merged.pid),
      "--owner-pid",
      String(merged.pid),
    ],
    { detached: true, stdio: "ignore" },
  );
  helper.unref?.();

  let finished = false;
  return {
    async heartbeat() {
      await heartbeatGateRecord(merged);
    },
    /** The first terminal result stands; a second finish is a no-op. */
    async finish(exitCode) {
      if (finished) return;
      finished = true;
      helper.kill("SIGTERM");
      await finishGateRecord({ ...merged, exitCode });
      await lifecycle("release", false).catch(() => {});
    },
  };
}

function flagValue(flags, name) {
  const index = flags.indexOf(name);
  if (index < 0 || index + 1 >= flags.length) return undefined;
  return flags[index + 1];
}

// Thin CLI so shell pipelines call the same writer. start writes the running record;
// heartbeat and finish update the record a previous start wrote, failing loudly when the
// identity does not match — the same contract gate-status.ts enforces for readers.
async function runCli(argv) {
  const [command, ...flags] = argv;
  const statusPath = flagValue(flags, "--status-path") ?? "artifacts/gates/status.json";
  const runId = requiredString(flagValue(flags, "--run-id"), "--run-id");
  const phase = requiredString(flagValue(flags, "--phase"), "--phase");
  const owner = flagValue(flags, "--owner") ?? defaultOwner();
  const pid = Number.parseInt(flagValue(flags, "--pid") ?? `${process.pid}`, 10);
  const identity = {
    owner,
    phase,
    pid: Number.isInteger(pid) && pid > 0 ? pid : process.pid,
    runId,
    statusPath,
  };
  if (command === "start") {
    await startGateRecord({ ...identity, command: flagValue(flags, "--command") ?? "" });
    return;
  }
  if (command === "heartbeat") {
    await heartbeatGateRecord(identity);
    return;
  }
  if (command === "finish") {
    await finishGateRecord({
      ...identity,
      exitCode: Number.parseInt(requiredString(flagValue(flags, "--exit-code"), "--exit-code"), 10),
    });
    return;
  }
  if (command === "heartbeat-loop") {
    // Dedicated helper for chains that block their own event loop with spawnSync: it
    // heartbeats the record and the worktree lease until the record turns terminal or the
    // owning process dies. Started detached by createGateRecorder.
    const ownerPid = Number.parseInt(flagValue(flags, "--owner-pid") ?? "", 10);
    const alive = () => {
      try {
        process.kill(ownerPid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const lifecycleScript = path.join(repoRoot, "scripts", "worktree-lifecycle.ts");
    const tick = async () => {
      try {
        await heartbeatGateRecord(identity);
        await execFileAsync(
          "pnpm",
          [
            "exec",
            "tsx",
            lifecycleScript,
            "heartbeat",
            "--phase",
            identity.phase,
            "--owner",
            identity.owner,
            "--pid",
            String(identity.pid),
            "--run-id",
            identity.runId,
          ],
          { cwd: repoRoot },
        );
      } catch {
        process.exit(0); // record terminal or unreadable: nothing left to heartbeat
      }
      if (!alive()) process.exit(0);
    };
    await tick();
    const timer = setInterval(tick, GATE_RECORDS_HEARTBEAT_INTERVAL_MS);
    process.on("SIGTERM", () => {
      clearInterval(timer);
      process.exit(0);
    });
    return;
  }
  throw new Error("usage: gate-records.mjs <start|heartbeat|finish|heartbeat-loop> [flags]");
}

if (process.argv[1] !== undefined) {
  const entry = path.resolve(process.argv[1]);
  const self = fileURLToPath(import.meta.url);
  if (entry === self) {
    runCli(process.argv.slice(2)).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
  }
}
