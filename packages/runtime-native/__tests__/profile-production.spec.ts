import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { makeTempDirSync } from "../../../test-support/temp-dir.js";

const STAGING_DIRECTORY = ".threenative-profile-production";

type Instrumentation = {
  /** The primary checkout that owns a checkout or linked worktree at `cwd`. */
  owningCheckout(cwd: string): string;
  /** The temporary staging parent for that checkout: outside every workspace, same volume. */
  stagingParentDirectory(
    primaryCheckout: string,
    workspaceExists?: (path: string) => boolean,
  ): string;
  webFrameInstrumentation(
    control: string | undefined,
    warmupFrames?: number,
    paceTicks?: boolean,
  ): string;
  nativeFrameInstrumentation(
    control: string | undefined,
    warmupFrames?: number,
    paceTicks?: boolean,
  ): string;
  productionExecutionHold(paceTicks?: boolean): string;
  nativeLaunchesExternalBundle(
    artifactPath: string,
    options: { prebuiltArtifact?: string },
  ): boolean;
};

async function instrumentation(): Promise<Instrumentation> {
  return (await import(
    new URL("../scripts/profile-production.mjs", import.meta.url).href
  )) as Instrumentation;
}

type FrameSample = { frameMs: number; presentationMs?: number };

interface SandboxHarness {
  bridge: { advance(ticks: number): Promise<unknown>; sample(): unknown };
  /** Every line the instrumentation reported; the web arm reports over the console, not a fetch. */
  lines: string[];
  timers: number[];
  /** Registers a consumer callback through the wrapper the instrumentation installed. */
  register(callback: () => void): void;
  /** Fires every scheduled callback once with one shared presentation timestamp. */
  present(timestamp: number): void;
}

function createSandbox(source: string): SandboxHarness {
  const scheduled: Array<(timestamp: number) => void> = [];
  const timers: number[] = [];
  const lines: string[] = [];
  let clock = 1_000;
  const bridge = {
    advance: async (ticks: number) => ({ clock: { mode: "fixed-step", tick: ticks }, ticks }),
    sample: () => ({}),
  };
  const sandbox: Record<string, unknown> = {
    Date,
    JSON,
    Number,
    Object,
    Promise,
    console: { log: (line: string) => lines.push(line) },
    performance: { now: () => clock },
    requestAnimationFrame: (callback: (timestamp: number) => void) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    setTimeout: (callback: () => void, milliseconds: number) => {
      timers.push(milliseconds);
      callback();
      return timers.length;
    },
    __THREENATIVE_PLAYTEST_BRIDGE__: bridge,
  };
  sandbox.globalThis = sandbox;
  runInNewContext(source, sandbox);
  return {
    bridge,
    lines,
    register: (callback) => {
      (sandbox.requestAnimationFrame as (callback: () => void) => number)(callback);
    },
    present: (timestamp) => {
      clock = timestamp;
      for (const callback of scheduled) callback(timestamp);
    },
    timers,
  };
}

describe("production profile frame sampling", () => {
  it("should count one frame per requestAnimationFrame presentation, not per callback", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(webFrameInstrumentation(undefined, 0));
    // Two consumers registered for the same presentation: the game loop and a second callback.
    harness.register(() => {});
    harness.register(() => {});
    for (let index = 0; index < 31; index += 1) {
      harness.present(1_000 + (index + 1) * (1_000 / 60));
    }
    const prefix = "TN_PROD_FRAME_SAMPLES:";
    const batch = harness.lines.find((line) => line.startsWith(prefix));
    const samples: FrameSample[] = JSON.parse((batch ?? `${prefix}[]`).slice(prefix.length));
    expect(samples).toHaveLength(30);
    expect(samples.every(({ frameMs }) => frameMs > 0)).toBe(true);
    const presentations = samples.map(({ presentationMs }) => presentationMs as number);
    expect(
      presentations.every((value, index) => index === 0 || value > (presentations[index - 1] ?? 0)),
    ).toBe(true);
  });

  it("should pace fixed-step advance to the loop tick interval", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(webFrameInstrumentation(undefined, 0, true));
    await harness.bridge.advance(10);
    expect(harness.timers).toContainEqual(expect.closeTo((1_000 / 60) * 10, 0.01));
  });

  it("should pace only when the synthetic duration workload asks for it", async () => {
    const { webFrameInstrumentation } = await instrumentation();
    const harness = createSandbox(webFrameInstrumentation(undefined, 0));
    await harness.bridge.advance(10);
    expect(harness.timers).toEqual([]);
  });

  it("should compile the native instrumentation with the same hold", async () => {
    const { nativeFrameInstrumentation, productionExecutionHold } = await instrumentation();
    expect(() => createSandbox(nativeFrameInstrumentation("slow-native", 0, true))).not.toThrow();
    expect(productionExecutionHold(true)).toContain("tnProductionPaceEnabled = true");
    expect(productionExecutionHold()).toContain("tnProductionPaceEnabled = false");
  });

  it("should pass an external bundle only to the bare prebuilt runtime", async () => {
    const { nativeLaunchesExternalBundle } = await instrumentation();
    const runtime = "/runtime/threenative";
    const packagedGame = "/project/dist-native/game";
    expect(nativeLaunchesExternalBundle(runtime, { prebuiltArtifact: runtime })).toBe(true);
    expect(nativeLaunchesExternalBundle(packagedGame, { prebuiltArtifact: runtime })).toBe(false);
    expect(nativeLaunchesExternalBundle(packagedGame, {})).toBe(false);
  });
});

/**
 * Git's own linked-checkout layout, built in a throwaway directory: a `.git` file naming an admin
 * directory whose `commondir` is the primary `.git`. No worktree is created in any real repository.
 */
function linkedCheckoutLayout(): { linked: string; primary: string; root: string } {
  const root = realpathSync(makeTempDirSync("tn-prod-staging-"));
  const primary = join(root, "primary");
  execFileSync("git", ["init", "--quiet", primary]);
  writeFileSync(join(primary, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const admin = join(primary, ".git", "worktrees", "linked");
  mkdirSync(admin, { recursive: true });
  writeFileSync(join(admin, "HEAD"), "ref: refs/heads/linked\n");
  writeFileSync(join(admin, "commondir"), "../..\n");
  const linked = join(primary, ".worktrees", "linked");
  mkdirSync(linked, { recursive: true });
  writeFileSync(join(linked, ".git"), `gitdir: ${admin}\n`);
  return { linked, primary, root };
}

function primaryCheckoutLayout(): { primary: string; root: string } {
  const root = realpathSync(makeTempDirSync("tn-prod-staging-"));
  const primary = join(root, "primary");
  execFileSync("git", ["init", "--quiet", primary]);
  writeFileSync(join(primary, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  return { primary, root };
}

describe("production profile staging", () => {
  it("should stage a linked checkout outside the owning workspace, where a real install lands in the game", async () => {
    const { owningCheckout, stagingParentDirectory } = await instrumentation();
    const { linked, primary, root } = linkedCheckoutLayout();
    try {
      expect(owningCheckout(linked)).toBe(primary);
      const parent = stagingParentDirectory(owningCheckout(linked));
      // Beside the primary checkout, never beside the linked one: `primary/.worktrees` is still
      // inside the primary workspace, where pnpm installs into the workspace root instead.
      expect(parent).toBe(join(root, STAGING_DIRECTORY));
      expect(relative(primary, parent).startsWith("..")).toBe(true);
      const game = join(parent, "threenative-production-test", "platformer");
      mkdirSync(game, { recursive: true });
      writeFileSync(
        join(game, "package.json"),
        '{"name":"platformer","private":true,"version":"0.0.0"}\n',
      );
      execFileSync("pnpm", ["install", "--ignore-scripts", "--offline", "--reporter=silent"], {
        cwd: game,
      });
      expect(existsSync(join(game, "node_modules"))).toBe(true);
      expect(existsSync(join(primary, "node_modules"))).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("should stage the primary checkout outside its own workspace", async () => {
    const { owningCheckout, stagingParentDirectory } = await instrumentation();
    const { primary, root } = primaryCheckoutLayout();
    try {
      expect(owningCheckout(primary)).toBe(primary);
      const parent = stagingParentDirectory(owningCheckout(primary));
      expect(parent).toBe(join(root, STAGING_DIRECTORY));
      for (
        let directory = parent;
        directory !== dirname(directory);
        directory = dirname(directory)
      ) {
        expect(existsSync(join(directory, "pnpm-workspace.yaml"))).toBe(false);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("should keep climbing while an ancestor is itself a workspace", async () => {
    const { stagingParentDirectory } = await instrumentation();
    const workspaces = new Set(["/w/pnpm-workspace.yaml", "/w/inner/pnpm-workspace.yaml"]);
    expect(stagingParentDirectory("/w/inner/checkout", (path) => workspaces.has(path))).toBe(
      join("/", STAGING_DIRECTORY),
    );
  });
});
