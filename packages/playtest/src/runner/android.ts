import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface IAndroidDriverOptions {
  activity: string;
  adbPath?: string;
  packageName: string;
  serial?: string;
}

export interface IAndroidDriver {
  captureConsole(): Promise<Array<{ text: string; type: string }>>;
  isAlive(): Promise<boolean>;
  prepare(endpoint: string, mailboxRoot?: string): Promise<void>;
  readFile?(path: string): Promise<string | undefined>;
  removeFile?(path: string): Promise<void>;
  screenshot(path: string): Promise<void>;
  stop(): Promise<void>;
  writeFile?(path: string, contents: string): Promise<void>;
}

export class AdbAndroidDriver implements IAndroidDriver {
  private readonly adbPath: string;

  constructor(private readonly options: IAndroidDriverOptions) {
    this.adbPath = options.adbPath ?? discoverAdb();
  }

  async prepare(endpoint: string, mailboxRoot?: string): Promise<void> {
    const url = new URL(endpoint);
    const port = url.port;
    await this.adb(["reverse", `tcp:${port}`, `tcp:${port}`]);
    await this.adb(["logcat", "-c"]);
    await this.adb(["shell", "am", "force-stop", this.options.packageName]);
    await this.adb([
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      `${this.options.packageName}/${this.options.activity}`,
      "--es",
      "TN_PLAYTEST_ENDPOINT",
      endpoint,
      ...(mailboxRoot === undefined ? [] : ["--es", "TN_PLAYTEST_MAILBOX_ROOT", mailboxRoot]),
    ]);
  }

  async captureConsole(): Promise<Array<{ text: string; type: string }>> {
    const output = await this.adb(["logcat", "-d", "-v", "brief"]);
    return output
      .split(/\r?\n/u)
      .filter((line) => /Mystral|THREENATIVE|chromium/u.test(line))
      .map((text) => ({
        text,
        type: /^(?:E|F)\//u.test(text) || /\b(?:Error|FATAL|FAILED)\b/u.test(text)
          ? "error"
          : "log",
      }));
  }

  async screenshot(path: string): Promise<void> {
    const { stdout } = await execFileAsync(this.adbPath, [
      ...this.serialArgs(),
      "exec-out",
      "screencap",
      "-p",
    ], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
    await writeFile(path, stdout);
  }

  async isAlive(): Promise<boolean> {
    return (await this.adb(["shell", "pidof", this.options.packageName])).trim().length > 0;
  }

  async readFile(path: string): Promise<string | undefined> {
    try {
      const contents = await this.adb(["exec-out", "cat", path]);
      return isMissingRemoteFileOutput(contents) ? undefined : contents;
    } catch (error) {
      if (isMissingRemoteFile(error)) return undefined;
      throw error;
    }
  }

  async removeFile(path: string): Promise<void> {
    await this.adb(["shell", "rm", "-f", path]);
  }

  async stop(): Promise<void> {
    await this.adb(["shell", "am", "force-stop", this.options.packageName]).catch(() => undefined);
    await this.adb(["reverse", "--remove-all"]).catch(() => undefined);
  }

  async writeFile(path: string, contents: string): Promise<void> {
    const directory = await mkdtemp(join(tmpdir(), "threenative-adb-mailbox-"));
    const localPath = join(directory, "payload.json");
    const remotePath = `${path}.incoming-${process.pid}-${Date.now()}`;
    try {
      await writeFile(localPath, contents, "utf8");
      await this.adb(["push", localPath, remotePath]);
      await this.adb(["shell", "mv", remotePath, path]);
    } finally {
      await rm(directory, { force: true, recursive: true });
      await this.adb(["shell", "rm", "-f", remotePath]).catch(() => undefined);
    }
  }

  private async adb(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        this.adbPath,
        [...this.serialArgs(), ...args],
        { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      );
      return stdout;
    } catch (error) {
      const detail = error as Error & { stderr?: string; stdout?: string };
      throw new Error(
        `adb ${args.join(" ")} failed: ${detail.stderr || detail.stdout || detail.message}`,
      );
    }
  }

  private serialArgs(): string[] {
    return this.options.serial === undefined ? [] : ["-s", this.options.serial];
  }
}

function isMissingRemoteFile(error: unknown): boolean {
  const detail = error as Error & { stderr?: string; stdout?: string };
  return isMissingRemoteFileOutput(`${detail.stderr ?? ""}\n${detail.stdout ?? ""}`);
}

function isMissingRemoteFileOutput(output: string): boolean {
  return /No such file|not found/u.test(output);
}

export function discoverAdb(environment: NodeJS.ProcessEnv = process.env): string {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const candidates = [
    environment.THREENATIVE_ADB,
    environment.ANDROID_SDK_ROOT === undefined
      ? undefined
      : join(environment.ANDROID_SDK_ROOT, "platform-tools", executable),
    environment.ANDROID_HOME === undefined
      ? undefined
      : join(environment.ANDROID_HOME, "platform-tools", executable),
    join(homedir(), "Android", "Sdk", "platform-tools", executable),
    join(homedir(), "Library", "Android", "sdk", "platform-tools", executable),
  ];
  const found = candidates.find((candidate): candidate is string =>
    candidate !== undefined && existsSync(candidate));
  if (found !== undefined) return found;
  if (environment.PATH?.split(process.platform === "win32" ? ";" : ":").some((directory) =>
    existsSync(join(directory, executable))) === true) return executable;
  throw new Error(
    "adb was not found. Install Android SDK Platform Tools, set ANDROID_HOME, or pass --adb /absolute/path/to/adb.",
  );
}
