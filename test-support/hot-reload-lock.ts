import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";

export const HOT_RELOAD_LOCK_STALE_AFTER_MS = 30_000;

interface IHotReloadLockRecord {
  pid: number;
  startedAt: number;
}

export interface IHotReloadProjectLockOptions {
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly lockPath: string;
  readonly now?: () => number;
  readonly pid?: number;
  readonly pollMs?: number;
  readonly staleAfterMs?: number;
  readonly timeoutMs?: number;
}

export interface IHotReloadProjectLock {
  release(): Promise<void>;
}

/**
 * Acquire the exclusive project-preparation lock, recovering only an old lock whose owner is
 * no longer alive. A live owner always wins, even when its preparation runs longer than the stale
 * threshold.
 */
export async function acquireHotReloadProjectLock(
  options: IHotReloadProjectLockOptions,
): Promise<IHotReloadProjectLock> {
  const now = options.now ?? Date.now;
  const pid = options.pid ?? process.pid;
  const pollMs = options.pollMs ?? 100;
  const staleAfterMs = options.staleAfterMs ?? HOT_RELOAD_LOCK_STALE_AFTER_MS;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const deadline = now() + timeoutMs;
  const owner = { pid, startedAt: now() } satisfies IHotReloadLockRecord;
  const serializedOwner = JSON.stringify(owner);

  while (now() < deadline) {
    const lease = await tryAcquireHotReloadProjectLock(options, serializedOwner);
    if (lease !== undefined) return lease;
    if (await recoverStaleLock(options, now, staleAfterMs)) continue;
    await wait(pollMs, deadline, now);
  }

  throw new Error(`Timed out waiting for ${options.lockPath} to become available.`);
}

async function tryAcquireHotReloadProjectLock(
  options: IHotReloadProjectLockOptions,
  serializedOwner: string,
): Promise<IHotReloadProjectLock | undefined> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(options.lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined;
    throw error;
  }
  try {
    await handle.writeFile(serializedOwner, "utf8");
    await handle.close();
    return {
      release: async () => {
        const current = await readFile(options.lockPath, "utf8").catch(() => undefined);
        if (current === serializedOwner) await rm(options.lockPath, { force: true });
      },
    };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(options.lockPath, { force: true });
    throw error;
  }
}

async function recoverStaleLock(
  options: IHotReloadProjectLockOptions,
  now: () => number,
  staleAfterMs: number,
): Promise<boolean> {
  const raw = await readFile(options.lockPath, "utf8").catch(() => undefined);
  if (raw === undefined) return false;
  const record = parseLockRecord(raw);
  const lockAge = await lockAgeMs(options.lockPath, record, now);
  if (lockAge < staleAfterMs) return false;
  if (record !== undefined) {
    const isAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    if (isAlive(record.pid)) return false;
  }
  const current = await readFile(options.lockPath, "utf8").catch(() => undefined);
  if (current !== raw) return false;
  const quarantinePath = `${options.lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(options.lockPath, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  await rm(quarantinePath, { force: true });
  return true;
}

function parseLockRecord(raw: string): IHotReloadLockRecord | undefined {
  try {
    const candidate = JSON.parse(raw) as Partial<IHotReloadLockRecord>;
    const pid = candidate.pid;
    const startedAt = candidate.startedAt;
    return typeof pid === "number" &&
      Number.isInteger(pid) &&
      pid > 0 &&
      typeof startedAt === "number" &&
      Number.isFinite(startedAt)
      ? { pid, startedAt }
      : undefined;
  } catch {
    return undefined;
  }
}

async function lockAgeMs(
  lockPath: string,
  record: IHotReloadLockRecord | undefined,
  now: () => number,
): Promise<number> {
  if (record !== undefined) return Math.max(0, now() - record.startedAt);
  const details = await stat(lockPath).catch(() => undefined);
  return details === undefined ? 0 : Math.max(0, now() - details.mtimeMs);
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function wait(pollMs: number, deadline: number, now: () => number): Promise<void> {
  const remaining = deadline - now();
  if (remaining <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
}
