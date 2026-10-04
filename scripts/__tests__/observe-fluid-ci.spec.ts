import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { makeTempDir } from "../../test-support/temp-dir.js";
const moduleUrl = new URL("../observe-fluid-ci.mjs", import.meta.url).href;
const { cgroupDirectory, counterDelta, observeFluidCi, projectBrowserLine } = await import(
  moduleUrl
);

test("launch flag and watchdog projections are enumerated facts without arbitrary text", () => {
  expect(
    projectBrowserLine(
      "pw:browser <launching> /private --enable-unsafe-webgpu --disable-gpu-watchdog --token=secret",
      1,
    ),
  ).toEqual({
    atMs: 1,
    event: "launch",
    flags: ["--enable-unsafe-webgpu", "--disable-gpu-watchdog"],
  });
  expect(
    projectBrowserLine(
      "pw:browser [pid=1][err] /private/gpu_watchdog_thread.cc password=secret",
      2,
    ),
  ).toEqual({ atMs: 2, event: "gpu-message", marker: "gpu_watchdog_thread.cc" });
});

test("observer interruption forwards to the owned child and removes listeners", async () => {
  const directory = await makeTempDir("fluid-observer-test-");
  const signalSource = new EventEmitter();
  const pending = observeFluidCi({
    artifactDirectory: directory,
    command: [process.execPath, "-e", "setInterval(()=>{},1000)"],
    snapshot: async () => null,
    signalSource,
    stderr: () => {},
  });
  await new Promise((done) => setTimeout(done, 30));
  signalSource.emit("SIGTERM");
  const result = await pending;
  expect(result.child).toEqual({ code: null, signal: "SIGTERM" });
  expect(result.interruptedBy).toBe("SIGTERM");
  expect(signalSource.listenerCount("SIGTERM")).toBe(0);
});

test("projects browser process facts without publishing argv, URLs or credentials", () => {
  expect(
    projectBrowserLine(
      "pw:browser <launching> /home/private/chrome --user-data-dir=/secret https://private.test token=abc",
      12,
    ),
  ).toEqual({ atMs: 12, event: "launch" });
  expect(projectBrowserLine("pw:browser <launched> pid=123", 13)).toEqual({
    atMs: 13,
    event: "launched",
    pid: 123,
  });
  expect(
    projectBrowserLine("pw:browser <process did exit: exitCode=null, signal=SIGKILL>", 20),
  ).toEqual({ atMs: 20, event: "exit", code: null, signal: "SIGKILL" });
  expect(projectBrowserLine('pw:browser [pid=123][err] password="private words"', 21)).toBeNull();
});

test("counter deltas are facts scoped to the observed cgroup, not process attribution", () => {
  expect(
    counterDelta({ oom_kill: 2, throttled_usec: 50 }, { oom_kill: 3, throttled_usec: 80 }),
  ).toEqual({ oom_kill: 1, throttled_usec: 30 });
  expect(counterDelta(null, { oom_kill: 3 })).toBeNull();
  expect(counterDelta({ oom_kill: 3 }, { oom_kill: 2 })).toEqual({ oom_kill: null });
});

test("a real fake child failure survives unavailable collectors and bounded private stderr", async () => {
  const directory = await makeTempDir("fluid-observer-test-");
  let forwarded = "";
  const result = await observeFluidCi({
    artifactDirectory: directory,
    command: [
      process.execPath,
      "-e",
      'process.stderr.write("pw:browser <launching> /home/private https://private.test token=secret\\nError: verifier failure\\n");process.exit(7)',
    ],
    snapshot: async () => {
      throw new Error("/private token=secret");
    },
    stderr: (text: string) => {
      forwarded += text;
    },
  });
  expect(result.child).toEqual({ code: 7, signal: null });
  const publicEvidence = await readFile(join(directory, "ci-diagnostics.json"), "utf8");
  expect(publicEvidence).not.toMatch(/private|token=|secret|launching|process.execPath/u);
  expect(forwarded).toContain("Error: verifier failure");
  expect(result.collectionErrors).toContain("snapshot-unavailable");
});

test("a real child signal is retained without converting it to success", async () => {
  const directory = await makeTempDir("fluid-observer-test-");
  const result = await observeFluidCi({
    artifactDirectory: directory,
    command: [process.execPath, "-e", 'process.kill(process.pid,"SIGTERM")'],
    snapshot: async () => null,
    stderr: () => {},
  });
  expect(result.child).toEqual({ code: null, signal: "SIGTERM" });
});

test("effective cgroup mapping does not substitute an unrelated mount root", () => {
  const mount = "1 2 0:1 /docker/owned /sys/fs/cgroup rw - cgroup2 cgroup rw";
  expect(cgroupDirectory("0::/docker/owned/child", mount)).toBe("/sys/fs/cgroup/child");
  expect(cgroupDirectory("0::/docker/sibling", mount)).toBeNull();
  expect(cgroupDirectory("1:memory:/docker/owned", mount)).toBeNull();
});

test("a throwing stderr collector and an unwritable artifact do not replace child failure", async () => {
  const directory = await makeTempDir("fluid-observer-test-");
  const file = join(directory, "not-a-directory");
  await writeFile(file, "occupied");
  const result = await observeFluidCi({
    artifactDirectory: file,
    command: [
      process.execPath,
      "-e",
      'process.stderr.write("Error: primary failure\\n");process.exit(7)',
    ],
    snapshot: async () => null,
    stderr: () => {
      throw new Error("private collector error");
    },
  });
  expect(result.child.code).toBe(7);
  expect(result.collectionErrors).toContain("stderr-sink-unavailable");
  expect(result.collectionErrors).toContain("artifact-write-failed");
});

test("oversized split DEBUG lines never leak their continuation or add unbounded events", async () => {
  const directory = await makeTempDir("fluid-observer-test-");
  let forwarded = "";
  const result = await observeFluidCi({
    artifactDirectory: directory,
    command: [
      process.execPath,
      "-e",
      'process.stderr.write("pw:browser <launching> "+"x".repeat(10000));setTimeout(()=>{process.stderr.write("private-continuation\\n"+"pw:browser <launched> pid=12\\n".repeat(100)+"pw:browser <process did exit: exitCode=7, signal=null>\\n");},20)',
    ],
    snapshot: async () => null,
    stderr: (text: string) => {
      forwarded += text;
    },
  });
  expect(forwarded).not.toContain("private-continuation");
  expect(result.browserEvents).toHaveLength(64);
  expect(result.terminalBrowserExit).toEqual({
    atMs: expect.any(Number),
    event: "exit",
    code: 7,
    signal: null,
  });
  expect(result.browserEventsTruncated).toBe(true);
  expect(JSON.stringify(result).length).toBeLessThan(12000);
});
