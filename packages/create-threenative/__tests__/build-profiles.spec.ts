import { existsSync, readFileSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parsePng } from "@threenative/assets";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rgbaPng } from "../../../test-support/png.js";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { build } from "../src/build.js";
import { loadConfig } from "../src/config.js";

// Only Vite's child process is stubbed: the asset compile below is the real one, because a
// resolved config object is not evidence that a texture was ever resized.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const spawn = ((_command: string, args: readonly string[]) => {
    const child = new EventEmitter();
    queueMicrotask(async () => {
      // A real Vite build creates the outDir it was pointed at, and the web build refuses to
      // publish one that is still missing — so the stub has to be as complete as what it replaces.
      const index = args.indexOf("--outDir");
      const out = args[index + 1];
      if (index >= 0 && out !== undefined) await mkdir(path.resolve(out), { recursive: true });
      child.emit("exit", 0);
    });
    return child;
  }) as unknown as typeof actual.spawn;
  return { ...actual, spawn };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function project(declared?: unknown): Promise<string> {
  const root = await makeTempDir("threenative-profile-");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "profile-game", type: "module", devDependencies: {} }),
  );
  await writeFile(
    path.join(root, "threenative.config.ts"),
    `export default ${JSON.stringify(declared ?? {}, null, 2)};\n`,
  );
  return root;
}

const TWO_PROFILES = {
  assets: { concurrency: 1, textures: { maxSize: 2048, quality: 200 } },
  buildProfiles: {
    defaults: { web: "compact" },
    profiles: {
      compact: { assets: { textures: { maxSize: 128 } } },
      standard: { assets: { textures: { maxSize: 2048 } } },
    },
  },
};

describe("build profile resolution", () => {
  it("prefers the flag over the target's default, and applies nothing when neither is declared", async () => {
    const root = await project(TWO_PROFILES);

    await expect(loadConfig(root, { target: "web" })).resolves.toMatchObject({
      assets: { textures: { maxSize: 128, quality: 200 } },
      buildProfile: { name: "compact", source: "default", target: "web" },
    });
    await expect(loadConfig(root, { profile: "standard", target: "web" })).resolves.toMatchObject({
      buildProfile: { name: "standard", source: "flag", target: "web" },
    });
    // Another target declares no default: that build cooks the base config unchanged.
    await expect(loadConfig(root, { target: "android" })).resolves.toMatchObject({
      assets: { textures: { maxSize: 2048, quality: 200 } },
    });
    expect((await loadConfig(root, { target: "android" })).buildProfile).toBeUndefined();
    // A caller that names no target at all keeps today's behaviour, overlay and provenance aside.
    await expect(loadConfig(root)).resolves.toMatchObject({
      assets: { textures: { maxSize: 2048, quality: 200 } },
    });
    expect((await loadConfig(root)).buildProfile).toBeUndefined();
    const bare = await project({ display: { orientation: "portrait" } });
    expect((await loadConfig(bare)).assets).toBeUndefined();
  });

  it("names the declared profiles when the requested one is not there", async () => {
    const root = await project(TWO_PROFILES);
    await expect(loadConfig(root, { profile: "ultra", target: "web" })).rejects.toThrow(
      /TN_CONFIG_PROFILE_UNKNOWN.*compact, standard/u,
    );
    const bare = await project({ assets: { textures: "none" } });
    await expect(loadConfig(bare, { profile: "compact", target: "web" })).rejects.toThrow(
      /declares no buildProfiles/u,
    );
    const missingDefault = await project({
      buildProfiles: { defaults: { android: "compact" }, profiles: { standard: {} } },
    });
    await expect(loadConfig(missingDefault, { target: "android" })).rejects.toThrow(
      /defaults\.android names 'compact', which is not declared/u,
    );
  });

  it("rejects a name that is not one safe path segment, an unknown profile key, and a forbidden overlay key", async () => {
    for (const name of ["../escape", "Upper", "with/slash", ""]) {
      const root = await project({ buildProfiles: { profiles: { [name]: {} } } });
      await expect(loadConfig(root, { target: "web" })).rejects.toThrow(
        /TN_CONFIG_PROFILE_NAME_INVALID/u,
      );
    }
    const unknownKey = await project({
      buildProfiles: { profiles: { compact: { artifact: { limit: 1 } } } },
    });
    await expect(loadConfig(unknownKey, { target: "web" })).rejects.toThrow(
      /buildProfiles\.profiles\['compact'\]\.artifact is not recognised/u,
    );
    for (const key of ["source", "output", "concurrency", "exclude"]) {
      const root = await project({
        buildProfiles: { profiles: { compact: { assets: { [key]: "elsewhere" } } } },
      });
      await expect(loadConfig(root, { profile: "compact", target: "web" })).rejects.toThrow(
        new RegExp(`assets\\.${key} is not recognised`, "u"),
      );
    }
    const empty = await project({ buildProfiles: { profiles: {} } });
    await expect(loadConfig(empty, { target: "web" })).rejects.toThrow(/at least one profile/u);
  });

  it("accepts a declared artifact budget and refuses a malformed one", async () => {
    const valid = await project({
      buildProfiles: {
        defaults: { web: "capped" },
        profiles: {
          capped: {
            artifactBudget: {
              artifactBytes: { limit: 5_000_000, severity: "warn" },
              packagedAssetBytes: { limit: 1, severity: "error" },
            },
          },
        },
      },
    });
    await expect(loadConfig(valid, { target: "web" })).resolves.toMatchObject({
      buildProfile: {
        name: "capped",
        artifactBudget: {
          artifactBytes: { limit: 5_000_000, severity: "warn" },
          packagedAssetBytes: { limit: 1, severity: "error" },
        },
      },
    });
    for (const artifactBudget of [
      { artifactBytes: { limit: 0, severity: "error" } },
      { artifactBytes: { limit: 1.5, severity: "error" } },
      { artifactBytes: { limit: 10, severity: "loud" } },
      { artifactBytes: { limit: 10 } },
      { artifactBytes: { limit: 10, severity: "error", tolerance: 1 } },
      { packagedBytes: { limit: 10, severity: "error" } },
    ]) {
      const root = await project({ buildProfiles: { profiles: { capped: { artifactBudget } } } });
      await expect(loadConfig(root, { target: "web" })).rejects.toThrow(
        /TN_CONFIG_(?:PROFILE_INVALID|UNKNOWN_KEY)/u,
      );
    }
  });

  it("merges objects field by field, replaces everything else, and leaves the project's own config untouched", async () => {
    const root = await makeTempDir("threenative-profile-merge-");
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "merge-game" }));
    // The config publishes itself so the test can prove the loader wrote to nothing it read.
    await writeFile(
      path.join(root, "threenative.config.ts"),
      [
        "const config = {",
        '  assets: { exclude: ["drafts/**"], textures: { maxSize: 2048, overrides: [{ codec: "etc1s", glob: "ui/**" }], quality: 200 } },',
        "  buildProfiles: {",
        "    profiles: {",
        "      merged: { assets: { textures: { maxSize: 128, overrides: [{ codec: 'uastc', glob: 'hero/**' }] } } },",
        '      none: { assets: { textures: "none" } },',
        "    },",
        "  },",
        "};",
        "globalThis.__tnProfileConfig = config;",
        "export default config;",
        "",
      ].join("\n"),
    );

    await expect(loadConfig(root, { profile: "merged", target: "web" })).resolves.toMatchObject({
      // A nested object merges; an array replaces; a key the overlay says nothing about stays.
      assets: {
        exclude: ["drafts/**"],
        textures: { maxSize: 128, overrides: [{ codec: "uastc", glob: "hero/**" }], quality: 200 },
      },
    });
    // An overlay object replaces a base `"none"`; an overlay `"none"` replaces a base object.
    await expect(loadConfig(root, { profile: "none", target: "web" })).resolves.toMatchObject({
      assets: { exclude: ["drafts/**"], textures: "none" },
    });
    const raw = (globalThis as { __tnProfileConfig?: { assets: unknown } }).__tnProfileConfig;
    expect(raw?.assets).toEqual({
      exclude: ["drafts/**"],
      textures: { maxSize: 2048, overrides: [{ codec: "etc1s", glob: "ui/**" }], quality: 200 },
    });
  });

  it('refuses a profile cap that a codec "none" override would silently ignore', async () => {
    const conflicting = await project({
      assets: { textures: { overrides: [{ codec: "none", glob: "ui/**" }] } },
      buildProfiles: { profiles: { compact: { assets: { textures: { maxSize: 128 } } } } },
    });
    await expect(loadConfig(conflicting, { profile: "compact", target: "web" })).rejects.toThrow(
      /TN_CONFIG_PROFILE_CONFLICT.*'compact'.*glob 'ui\/\*\*'/u,
    );
    const modelSlot = await project({
      assets: {
        models: { textures: { overrides: [{ codec: "none", slot: "baseColorTexture" }] } },
      },
      buildProfiles: {
        profiles: { compact: { assets: { models: { textures: { maxSize: 64 } } } } },
      },
    });
    await expect(loadConfig(modelSlot, { profile: "compact", target: "web" })).rejects.toThrow(
      /TN_CONFIG_PROFILE_CONFLICT.*slot 'baseColorTexture'/u,
    );
    // The negative control: an override that compresses is compatible with a cap.
    const compatible = await project({
      assets: { textures: { overrides: [{ codec: "etc1s", glob: "ui/**" }] } },
      buildProfiles: { profiles: { compact: { assets: { textures: { maxSize: 128 } } } } },
    });
    await expect(
      loadConfig(compatible, { profile: "compact", target: "web" }),
    ).resolves.toMatchObject({ assets: { textures: { maxSize: 128 } } });
  });
});

/** A real 256x256 PNG, a two-profile config, and enough `node_modules` for a genuine web bake. */
async function cookableProject(): Promise<string> {
  const root = await makeTempDir("threenative-profile-bake-");
  await mkdir(path.join(root, "assets"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "vite"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "cook-game", type: "module" }),
  );
  // High-entropy pixels: the PNG stays large, so the KTX2 pass encodes rather than deferring
  // to the source on size.
  await writeFile(
    path.join(root, "assets", "rock.png"),
    rgbaPng({
      blue: (x, y) => (x * 31 + y * 17) % 256,
      green: (x, y) => (x * 7 + y * 29) % 256,
      height: 256,
      red: (x, y) => (x * 13 + y * 11) % 256,
      width: 256,
    }),
  );
  await writeFile(
    path.join(root, "threenative.config.ts"),
    [
      "export default {",
      "  assets: { concurrency: 1 },",
      "  buildProfiles: {",
      "    defaults: { web: 'compact' },",
      "    profiles: {",
      "      compact: { assets: { textures: { maxSize: 128 } } },",
      "      tiny: { assets: { textures: { maxSize: 64 } } },",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "node_modules", "vite", "package.json"),
    JSON.stringify({ name: "vite", type: "module", version: "0.0.0" }),
  );
  // The bake copies three's Basis transcoder next to its output, resolved through this project.
  await symlink(
    path.resolve("packages/core/node_modules/three"),
    path.join(root, "node_modules", "three"),
    "dir",
  );
  return root;
}

/** The emitted file's real pixel dimensions, read from the container the pass wrote. */
function cookedSize(root: string, logical: string): { height: number; width: number } {
  const output = path.join(root, "public");
  const manifest = JSON.parse(readFileSync(path.join(output, "assets.manifest.json"), "utf8")) as {
    entries: Record<string, { output: string }>;
  };
  const bytes = readFileSync(path.join(output, manifest.entries[logical]?.output ?? "missing"));
  if (bytes.subarray(1, 7).toString() === "KTX 20") {
    // KTX2: identifier[12], vkFormat, typeSize, pixelWidth, pixelHeight.
    return { height: bytes.readUInt32LE(24), width: bytes.readUInt32LE(20) };
  }
  const png = parsePng(bytes);
  if (png === undefined) throw new Error(`${logical} was emitted as neither KTX2 nor PNG.`);
  return { height: png.height, width: png.width };
}

describe("threenative build --profile end to end", () => {
  it("cooks the selected profile's cap into the bytes the build emits", async () => {
    const root = await cookableProject();
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    await build({ cwd: root, target: "web" });
    expect(cookedSize(root, "rock.png")).toEqual({ height: 128, width: 128 });

    await build({ cwd: root, target: "web", profile: "tiny" });
    expect(cookedSize(root, "rock.png")).toEqual({ height: 64, width: 64 });
    expect(lines).toContain("threenative build: profile compact (default) for web\n");
    expect(lines).toContain("threenative build: profile tiny (flag) for web\n");
  }, 60_000);

  it("refuses an undeclared profile before writing any output", async () => {
    const root = await cookableProject();

    await expect(build({ cwd: root, target: "web", profile: "ultra" })).rejects.toThrow(
      /TN_CONFIG_PROFILE_UNKNOWN.*compact, tiny/u,
    );
    expect(existsSync(path.join(root, "public"))).toBe(false);
  });
});
