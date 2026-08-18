import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { assertCaptureNotBlank } from "../capture.js";
import type { IDevicePlaytestDriver } from "./androidRunner.js";

const SCREENSHOT_TIMEOUT_MS = 5_000;
const SCREENSHOT_REQUEST_FILE = "tn-playtest-screenshot-request.txt";
const SCREENSHOT_REQUEST_TEMP_FILE = `${SCREENSHOT_REQUEST_FILE}.tmp`;

export interface IDesktopPlaytestDriverOptions {
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  executable: string;
  mailboxRoot?: string;
  screenshotTimeoutMs?: number;
}

/** A local mailbox implementation with atomic request writes. */
export class LocalDeviceMailbox {
  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async write(path: string, contents: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, contents, "utf8");
    await rename(temporary, path);
  }
}

/**
 * Launches a packaged native desktop game and exposes the same driver contract as device runs.
 * The native runtime consumes TN_PLAYTEST_MAILBOX_ROOT before it evaluates the game entry.
 */
export class DesktopPlaytestDriver implements IDevicePlaytestDriver {
  private child?: ChildProcess;
  private mailboxRoot?: string;
  private readonly consoleEntries: Array<{ text: string; type: string }> = [];
  private readonly pendingOutput = { stderr: "", stdout: "" };

  constructor(private readonly options: IDesktopPlaytestDriverOptions) {}

  async captureConsole(): Promise<Array<{ text: string; type: string }>> {
    this.flushOutput("stdout");
    this.flushOutput("stderr");
    return [...this.consoleEntries];
  }

  async isAlive(): Promise<boolean> {
    return this.child !== undefined
      && this.child.exitCode === null
      && this.child.signalCode === null;
  }

  async prepare(_endpoint: string, mailboxRoot?: string): Promise<void> {
    if (this.child !== undefined && await this.isAlive()) {
      throw new Error("Desktop playtest executable is already running.");
    }
    this.mailboxRoot = mailboxRoot ?? this.options.mailboxRoot;
    if (this.mailboxRoot === undefined) {
      throw new Error("Desktop playtest requires a local mailbox root.");
    }
    await mkdir(this.mailboxRoot, { recursive: true });
    await Promise.all([
      rm(join(this.mailboxRoot, SCREENSHOT_REQUEST_FILE), { force: true }),
      rm(join(this.mailboxRoot, SCREENSHOT_REQUEST_TEMP_FILE), { force: true }),
    ]);
    this.consoleEntries.length = 0;
    this.pendingOutput.stdout = "";
    this.pendingOutput.stderr = "";
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ...(process.platform === "linux" && process.env.SDL_VIDEODRIVER === undefined
        ? { SDL_VIDEODRIVER: "x11" }
        : {}),
      MYSTRAL_HEADLESS: "1",
      ...this.options.env,
      TN_PLAYTEST_MAILBOX_ROOT: this.mailboxRoot,
    };
    const child = spawn(this.options.executable, [...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    child.stdout?.on("data", (chunk: Buffer | string) => this.recordOutput("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer | string) => this.recordOutput("stderr", chunk));
    try {
      await waitForSpawn(child);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async screenshot(path: string): Promise<void> {
    const root = this.mailboxRoot;
    if (root === undefined) throw new Error("Desktop playtest mailbox is unavailable before prepare().");
    if (!(await this.isAlive())) throw new Error("Desktop playtest executable exited before screenshot capture.");
    await rm(path, { force: true });
    const request = join(root, SCREENSHOT_REQUEST_FILE);
    await new LocalDeviceMailbox().write(request, path);
    const deadline = Date.now() + (this.options.screenshotTimeoutMs ?? SCREENSHOT_TIMEOUT_MS);
    let lastReadError: unknown;
    while (Date.now() < deadline) {
      try {
        const png = await readFile(path);
        assertCaptureNotBlank(png, path);
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "CaptureGuardError") throw error;
        if (!isMissingFile(error)) lastReadError = error;
      }
      if (!(await this.isAlive())) {
        throw new Error("Desktop playtest executable exited before screenshot capture.");
      }
      await delay(25);
    }
    throw new Error(
      `TN_PLAYTEST_NATIVE_SCREENSHOT_UNAVAILABLE: ${lastReadError instanceof Error ? lastReadError.message : "request timed out"}`,
    );
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    try {
      if (!isProcessExited(child) && child.pid !== undefined) {
        terminateProcess(child, "SIGTERM");
        const terminatedByTerm = await waitForExit(child, 2_000);
        if (!terminatedByTerm && !isProcessExited(child)) {
          terminateProcess(child, "SIGKILL");
          const terminatedByKill = await waitForExit(child, 1_000);
          if (!terminatedByKill || !isProcessExited(child)) {
            throw new Error("Desktop playtest executable did not exit after SIGTERM or SIGKILL.");
          }
        } else if (!isProcessExited(child)) {
          throw new Error("Desktop playtest executable did not exit after SIGTERM.");
        }
      }
    } finally {
      this.flushOutput("stdout");
      this.flushOutput("stderr");
    }
  }

  private recordOutput(stream: "stderr" | "stdout", chunk: Buffer | string): void {
    const text = `${this.pendingOutput[stream]}${String(chunk)}`;
    const lines = text.split(/\r?\n/u);
    this.pendingOutput[stream] = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) this.consoleEntries.push({ text: line, type: stream === "stderr" ? "error" : "log" });
    }
  }

  private flushOutput(stream: "stderr" | "stdout"): void {
    const line = this.pendingOutput[stream];
    if (line.length > 0) {
      this.consoleEntries.push({ text: line, type: stream === "stderr" ? "error" : "log" });
      this.pendingOutput[stream] = "";
    }
  }
}

function terminateProcess(child: ChildProcess, signal: "SIGKILL" | "SIGTERM"): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = (): void => {
      child.off("error", onError);
      resolve();
    };
    const onError = (error: Error): void => {
      child.off("spawn", onSpawn);
      reject(error);
    };
    child.once("spawn", onSpawn);
    child.once("error", onError);
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (isProcessExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function isProcessExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
