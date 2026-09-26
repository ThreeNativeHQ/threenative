import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileAssets } from "@threenative/assets";
import { BUILD_REPORT_SUFFIX, measureTreeBytes, writeBuildReport } from "./buildReport.js";
import { writeCompressionSidecars } from "./compress.js";
import { type IResolvedThreeNativeConfig, loadConfig } from "./config.js";

export type BuildTarget = "android" | "desktop" | "ios" | "web";
type NativeBuildTarget = Exclude<BuildTarget, "web">;
/** PRD-212: a debug APK by default; release is an explicit request. */
export type BuildMode = "debug" | "release";
/** PRD-212: the Android artifact shape. An app bundle is only meaningful for a release. */
export type BuildFormat = "apk" | "aab";
export type NativeOrientation = IResolvedThreeNativeConfig["display"]["orientation"];

export interface IBuildOptions {
  cwd?: string;
  target: BuildTarget;
  allowSourceBuild?: boolean;
  /**
   * Android and desktop. Desktop `release` wraps the executable in a complete OS container;
   * omitted keeps the raw-binary debug behavior.
   */
  mode?: BuildMode;
  /** Android only. `aab` requires `mode: "release"`. */
  format?: BuildFormat;
  /** A `buildProfiles` name; wins over `buildProfiles.defaults[target]`. */
  profile?: string;
  viteArgs?: readonly string[];
}

const TARGETS: readonly BuildTarget[] = ["web", "desktop", "android", "ios"];
function projectRequire(cwd: string): NodeJS.Require {
  return createRequire(path.join(cwd, "package.json"));
}

function packageRoot(cwd: string, packageName: string): string {
  try {
    return path.dirname(projectRequire(cwd).resolve(`${packageName}/package.json`));
  } catch {
    throw new Error(`Cannot build because '${packageName}' is not installed in ${cwd}.`);
  }
}

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited with code ${code ?? "unknown"}.`));
    });
  });
}

async function projectName(cwd: string): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8")) as {
    name?: string;
  };
  const name = manifest.name?.replace(/^@[^/]+\//u, "").replace(/[^a-zA-Z0-9._-]/gu, "-");
  if (name === undefined || name.length === 0) throw new Error("package.json must name the game.");
  return name;
}

export async function assertNativeBundleCompatible(
  bundle: string,
  target: NativeBuildTarget,
): Promise<void> {
  const source = await readFile(bundle, "utf8");
  const webOnlyUi = [
    ["React DOM", /\breact-dom(?:\/client)?\b|\bcreateRoot\s*\(/u],
    ["document.getElementById", /\bdocument\.getElementById\s*\(/u],
  ].filter(([, pattern]) => (pattern as RegExp).test(source));
  if (webOnlyUi.length > 0) {
    throw new Error(
      `TN_NATIVE_WEB_ONLY_UI: ${target} bundle contains ${webOnlyUi.map(([label]) => label).join(", ")}. Keep the portable game in src/game.ts and move DOM or React mounting to src/main.ts; native UI is owned by PRD-051.`,
    );
  }
  if (target === "desktop") return;
  const wasm = [
    ["WebAssembly", /\bWebAssembly\b/u],
    ["Rapier WASM", /rapier_wasm|RAPIER_VERSION|rawrapier/u],
    ["Recast WASM", /recast-navigation\.wasm|recastnavigationwasm/u],
  ].filter(([, pattern]) => (pattern as RegExp).test(source));
  if (wasm.length === 0) return;
  throw new Error(
    `TN_NATIVE_WASM_ON_MOBILE: ${target} bundle contains ${wasm.map(([label]) => label).join(", ")}. Move web-only WASM imports out of src/game.ts or provide a threenative-native conditional backend; mobile navigation is owned by PRD-052.`,
  );
}

/**
 * Refuse a web UI target before native packaging can silently discard its bundle. Android and iOS
 * own platform overlays, and the desktop overlay now ships its Windows (WebView2), macOS (WKWebView)
 * and Linux (X11/Wayland) backends behind the one ABI — proved by the hosted `windows-2025`/
 * `macos-15` starter lanes and the Linux session proofs. A host without one of those desktop window
 * systems still refuses rather than shipping a bundle nothing can render.
 */
export function assertNativeUiRendererCompatible(
  target: NativeBuildTarget,
  renderer: IResolvedThreeNativeConfig["ui"]["renderer"],
  platform: NodeJS.Platform = process.platform,
): void {
  if (renderer === "native" || target === "android" || target === "ios") return;
  if (
    target === "desktop" &&
    (platform === "linux" || platform === "darwin" || platform === "win32")
  ) {
    return;
  }
  const platformName =
    platform === "darwin" ? "macOS" : platform === "win32" ? "Windows" : platform;
  throw new Error(
    `TN_UI_RENDERER_UNSUPPORTED: ui.renderer is "web", but ${target} has no WebView host on ${platformName}. Set ui.renderer to "native" for ${target}.`,
  );
}

/** glTF extensions whose geometry only decodes through a WASM decoder. */
const COMPRESSED_MODEL_EXTENSIONS: readonly string[] = [
  "EXT_meshopt_compression",
  "KHR_draco_mesh_compression",
  "KHR_meshopt_compression",
];

function namedAssets(logicalPaths: readonly string[]): string {
  const shown = logicalPaths.slice(0, 3).join(", ");
  const rest = logicalPaths.length - 3;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** The compiled asset root this project's config chose, resolved against the project directory. */
export function assetRoot(cwd: string, config: IResolvedThreeNativeConfig): string {
  return path.resolve(cwd, config.assets?.output ?? "public");
}

/**
 * Refuses compiled assets a mobile native target cannot decode, at the first point the build
 * knows about them — after the compile step, before a bundle or an APK exists.
 *
 * Android runs QuickJS and iOS runs JavaScriptCore without a WASM JIT, so neither has
 * `WebAssembly`. Three's Basis/zstd transcoder, its Meshopt decoder and Draco's wasm decoder
 * therefore cannot run there and are not in the mobile bundle at all (they are replaced in
 * `runtime-native/scripts/bundle.mjs`, which is what keeps `TN_NATIVE_WASM_ON_MOBILE` green).
 * A game that genuinely ships such an asset must hear that here rather than discover it as a
 * missing texture on a phone.
 */
export async function assertNativeAssetsCompatible(
  cwd: string,
  target: BuildTarget,
  config: IResolvedThreeNativeConfig,
): Promise<void> {
  if (target === "desktop" || target === "web") return;
  const outputRoot = assetRoot(cwd, config);
  const manifestPath = path.join(outputRoot, "assets.manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `TN_NATIVE_ASSET_MANIFEST_INVALID: '${manifestPath}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries = (parsed as { entries?: unknown }).entries;
  if (typeof entries !== "object" || entries === null) {
    throw new Error(`TN_NATIVE_ASSET_MANIFEST_INVALID: '${manifestPath}' has no 'entries' object.`);
  }
  const rows = Object.entries(entries as Record<string, unknown>).map(
    ([logical, entry]) => [logical, (entry ?? {}) as Record<string, unknown>] as const,
  );
  const ktx2 = rows
    .filter(([, entry]) => typeof entry.output === "string" && /\.ktx2$/iu.test(entry.output))
    .map(([logical]) => logical);
  if (ktx2.length > 0) {
    throw new Error(
      `TN_NATIVE_KTX2_UNSUPPORTED: ${target} cannot ship compiled KTX2 textures (${namedAssets(ktx2)}). The mobile native runtime has no WebAssembly and therefore no Basis transcoder, so nothing in the bundle can decode them. Replace or transcode the authored KTX2 source for mobile, or exclude it from mobile builds; keep compressed textures on the web target.`,
    );
  }
  const compressedModels = rows
    .filter(([, entry]) =>
      (Array.isArray(entry.extensions) ? (entry.extensions as unknown[]) : []).some(
        (extension) =>
          typeof extension === "string" && COMPRESSED_MODEL_EXTENSIONS.includes(extension),
      ),
    )
    .map(([logical]) => logical);
  if (compressedModels.length > 0) {
    throw new Error(
      `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED: ${target} cannot ship compressed model geometry (${namedAssets(compressedModels)}). The mobile native runtime has no WebAssembly and therefore no Meshopt or Draco decoder. Native compilation keeps shared images and decoder-free model rewrites while omitting Meshopt output; rebuild the native target, or keep compressed models on the web target.`,
    );
  }
}

/** Which representation a build is cooking, and whether the flag or the project's default chose it. */
function announceProfile(config: IResolvedThreeNativeConfig): void {
  const selected = config.buildProfile;
  if (selected === undefined) return;
  process.stdout.write(
    `threenative build: profile ${selected.name} (${selected.source}) for ${selected.target}\n`,
  );
}

/** The one UI entry every target mounts. Convention, not configuration. */
const UI_ENTRY = path.join("src", "ui", "main.tsx");
/**
 * The generated entry page, written into the Vite root rather than under `.threenative/build/`.
 *
 * Vite emits an entry HTML at the same path *inside* `outDir` that it had inside the root, and
 * `base: "./"` writes every asset link relative to that path. A page generated two directories
 * deep came out with `../../assets/index.js`, which was correct where Vite put it and wrong the
 * moment the file was moved to the output root — nothing rewrites the links. Served from `/ui/`,
 * the web view then asked for `/assets/index.js`, outside the handler that serves the UI, and
 * rendered a blank page over the game: on a screenshot, a game whose HUD code is broken.
 *
 * Keeping the page in the root makes the emitted path the output root, so the rename below is
 * within one directory and `./assets/...` keeps resolving.
 */
const UI_PAGE_PREFIX = ".threenative-ui-";

/**
 * Build `src/ui/` on its own, for the platform's web view to load.
 *
 * The page is UI only: no scene, no simulation, no render path. It is built through the
 * project's own Vite config so the game's Tailwind, PostCSS, aliases and plugins apply exactly
 * as they do on the web target — that equivalence is the whole point, and re-deriving the
 * toolchain here would be a second build that drifts from the first.
 *
 * The generated entry lives under `.threenative/build/` and the Vite root stays the project, so
 * `/src/ui/main.tsx` resolves the same way it does in `index.html`.
 */
export async function buildUi(cwd: string, config: IResolvedThreeNativeConfig): Promise<string> {
  const output = path.join(cwd, ".threenative", "build", "ui");
  const entry = path.join(cwd, UI_ENTRY);
  try {
    if (!(await stat(entry)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(
      `TN_UI_ENTRY_MISSING: ui.renderer is "${config.ui.renderer}" but ${UI_ENTRY} does not exist. It is the entry every platform's web view loads; create it, or set ui.renderer to "native".`,
    );
  }
  const buildRoot = path.join(cwd, ".threenative", "build");
  await mkdir(buildRoot, { recursive: true });
  const page = path.join(cwd, `${UI_PAGE_PREFIX}${randomUUID()}.html`);
  // `viewport-fit=cover` so the UI can reach under a display cutout, and a transparent body so
  // the game surface underneath is what shows through everywhere the UI does not draw.
  await writeFile(
    page,
    [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
      "    <style>html,body,#tn-ui{margin:0;height:100%;background:transparent}</style>",
      "  </head>",
      "  <body>",
      '    <div id="tn-ui"></div>',
      `    <script type="module" src="/${UI_ENTRY.split(path.sep).join("/")}"></script>`,
      "  </body>",
      "</html>",
    ].join("\n"),
  );
  const driver = path.join(buildRoot, "build-ui.mjs");
  await writeFile(driver, uiBuildDriver(cwd, page, output));
  try {
    await run(process.execPath, [driver], cwd);
  } finally {
    await rm(page, { force: true });
  }
  const generatedPage = path.join(output, path.basename(page));
  const index = path.join(output, "index.html");
  await rename(generatedPage, index);
  return output;
}

/**
 * Vite's Node API rather than its CLI, because the CLI cannot point a build at an entry HTML
 * outside the project's own `index.html` without a config file — and a hand-written config file
 * would be a second copy of the game's, which is the drift this avoids.
 */
function uiBuildDriver(cwd: string, page: string, output: string): string {
  const literal = (value: string): string => JSON.stringify(value);
  return `${[
    'import { build, loadConfigFromFile, mergeConfig } from "vite";',
    "",
    `const root = ${literal(cwd)};`,
    `const loaded = await loadConfigFromFile({ command: "build", mode: "production" }, undefined, root);`,
    "await build(",
    "  mergeConfig(loaded?.config ?? {}, {",
    "    root,",
    '    base: "./",',
    // The UI is a HUD page, not the game: it must not carry the game's `public/`. Vite copies
    // `publicDir` into every build it runs, and this output is packaged *beside* the game's own
    // assets — so every model, texture and sound shipped twice. One game's APK came to 361 MB, of
    // which 97.6 MB was a second copy of its own 97.3 MB asset directory, six copies of one 11 MB
    // weapon among them. Nothing in `src/ui/` reads those files; it reaches the game through
    // published state and intents.
    "    publicDir: false,",
    // One React, one ReactDOM, whatever the import graph looks like. The UI entry resolves its
    // peers beside the game while a linked package — `@threenative/ui`, or anything else pnpm
    // symlinks in — resolves the same bare specifiers beside itself, so a hook-owning package
    // installed outside the project brings a second physical copy into the bundle. React's
    // dispatcher lives in module state, so the copy the entry did not mount reads null and the
    // first `useState` on the phone throws `Cannot read properties of null`. `mergeConfig`
    // concatenates arrays, so a project that deduped its own packages keeps every one of them.
    '    resolve: { dedupe: ["react", "react-dom"] },',
    "    build: {",
    `      outDir: ${literal(output)},`,
    "      emptyOutDir: true,",
    `      rollupOptions: { input: { index: ${literal(page)} } },`,
    "    },",
    "  }),",
    ");",
  ].join("\n")}\n`;
}

export async function buildWeb(
  cwd: string,
  viteArgs: readonly string[] = [],
  profile?: string,
): Promise<void> {
  const config = await loadConfig(cwd, { target: "web", profile });
  announceProfile(config);
  await compileAssets({ config: config.assets, cwd, platform: "web" });
  // Vite empties and rewrites its outDir in place, so a build that dies half-way through leaves a
  // truncated `dist` where a working one used to be — the same failure a native artifact had, and
  // the same repair. Vite is handed a staging sibling, every post-step runs against it, and only a
  // finished build publishes. Nothing the UI adds lands here: the web view is part of this one
  // Vite build through `index.html`, and `buildUi`'s own output is native packaging's, under
  // `.threenative/build/ui`.
  const outDir = path.resolve(cwd, viteOutDir(viteArgs));
  const staging = stagingPath(outDir);
  try {
    await mkdir(path.dirname(staging), { recursive: true });
    await run(
      process.execPath,
      [
        path.join(packageRoot(cwd, "vite"), "bin/vite.js"),
        "build",
        ...stagedViteArgs(viteArgs, staging),
      ],
      cwd,
    );
    await pruneUnpackagedAssets(cwd, config, staging);
    const report = await writeCompressionSidecars(staging);
    if (report !== undefined) {
      process.stdout.write(
        `web main chunk ${report.entry}: raw ${report.raw} B, gzip ${report.gzip} B, brotli ${report.brotli} B\n`,
      );
    }
    await writeBuildReport({
      artifact: staging,
      assets: assetRoot(cwd, config),
      config,
      packagedAssetBytes: await measurePackagedAssetBytes(cwd, assetRoot(cwd, config)),
      target: "web",
    });
    await publishStagedArtifact(outDir, staging);
  } catch (error) {
    // Nothing half-written survives the failure, and `outDir` was never written to.
    await rm(path.dirname(staging), { force: true, recursive: true });
    throw error;
  }
}

/**
 * Remove from the Vite outDir exactly the compiled files packaging would have dropped.
 *
 * Vite copies the whole output root, so a cook output no current bake declares rides along into
 * a web build. The rule is the packagers' own selector, imported from the runtime-native package
 * every template installs; a web-only project that does not have it keeps Vite's copy, because
 * there is no packaging selector shipped to ask.
 */
async function pruneUnpackagedAssets(
  cwd: string,
  config: IResolvedThreeNativeConfig,
  outDir: string,
): Promise<void> {
  const assets = assetRoot(cwd, config);
  if (!existsSync(assets)) return;
  const selector = await packagingSelector(cwd);
  if (selector === undefined) return;
  for (const file of selector.selectManifestAssets(assets).dropped)
    await rm(path.join(outDir, file), { force: true });
}

/** Vite's `--outDir`, or its `dist` default when the project left it to the config. */
function viteOutDir(viteArgs: readonly string[]): string {
  const index = viteArgs.findIndex((arg) => arg === "--outDir" || arg.startsWith("--outDir="));
  if (index === -1) return "dist";
  const flag = viteArgs[index] as string;
  return flag.startsWith("--outDir=")
    ? flag.slice("--outDir=".length)
    : (viteArgs[index + 1] ?? "dist");
}

/** The same args with their `--outDir` pointed at the staging sibling, and nothing else changed. */
function stagedViteArgs(viteArgs: readonly string[], staging: string): string[] {
  const index = viteArgs.findIndex((arg) => arg === "--outDir" || arg.startsWith("--outDir="));
  if (index === -1) return [...viteArgs, "--outDir", staging];
  const staged = [...viteArgs];
  if ((staged[index] as string).startsWith("--outDir=")) staged[index] = `--outDir=${staging}`;
  else staged[index + 1] = staging;
  return staged;
}

async function nativeEntry(cwd: string, config?: IResolvedThreeNativeConfig): Promise<string> {
  const relative = (config ?? (await loadConfig(cwd))).nativeEntry;
  const entry = path.resolve(cwd, relative);
  try {
    if (!(await stat(entry)).isFile()) throw new Error("not a file");
  } catch {
    throw new Error(`TN_NATIVE_ENTRY_MISSING: ${relative} does not exist.`);
  }
  return entry;
}

export async function nativeOrientation(cwd: string): Promise<NativeOrientation> {
  return (await loadConfig(cwd)).display.orientation;
}

export function resolvePackagingConfig(
  cwd: string,
  config: IResolvedThreeNativeConfig,
): IResolvedThreeNativeConfig {
  const resolve = (value: string | undefined): string | undefined =>
    value === undefined ? undefined : path.resolve(cwd, value);
  const artifact: IResolvedThreeNativeConfig = {
    ...config,
    app: {
      ...config.app,
      ...(config.app.icon === undefined ? {} : { icon: path.resolve(cwd, config.app.icon) }),
      ...(config.app.icons === undefined
        ? {}
        : {
            icons: {
              ...(config.app.icons.android === undefined
                ? {}
                : {
                    android: {
                      ...(config.app.icons.android.foreground === undefined
                        ? {}
                        : { foreground: path.resolve(cwd, config.app.icons.android.foreground) }),
                      ...(config.app.icons.android.background === undefined
                        ? {}
                        : { background: config.app.icons.android.background }),
                      ...(config.app.icons.android.monochrome === undefined
                        ? {}
                        : { monochrome: path.resolve(cwd, config.app.icons.android.monochrome) }),
                    },
                  }),
              ...(config.app.icons.ios === undefined
                ? {}
                : {
                    ios: {
                      ...(config.app.icons.ios.dark === undefined
                        ? {}
                        : { dark: path.resolve(cwd, config.app.icons.ios.dark) }),
                      ...(config.app.icons.ios.tinted === undefined
                        ? {}
                        : { tinted: path.resolve(cwd, config.app.icons.ios.tinted) }),
                    },
                  }),
              ...(config.app.icons.web === undefined
                ? {}
                : {
                    web: {
                      ...(config.app.icons.web.favicon === undefined
                        ? {}
                        : { favicon: resolve(config.app.icons.web.favicon) }),
                      ...(config.app.icons.web.maskable === undefined
                        ? {}
                        : { maskable: resolve(config.app.icons.web.maskable) }),
                      ...(config.app.icons.web.monochrome === undefined
                        ? {}
                        : { monochrome: resolve(config.app.icons.web.monochrome) }),
                      ...(config.app.icons.web.appleTouch === undefined
                        ? {}
                        : { appleTouch: resolve(config.app.icons.web.appleTouch) }),
                    },
                  }),
            },
          }),
    },
    ...(config.bootSplash === undefined
      ? {}
      : {
          bootSplash: {
            ...config.bootSplash,
            ...(config.bootSplash.image === undefined
              ? {}
              : { image: path.resolve(cwd, config.bootSplash.image) }),
          },
        }),
  };
  return artifact;
}

export async function writePackagingConfig(
  cwd: string,
  config: IResolvedThreeNativeConfig,
): Promise<string> {
  const directory = path.join(cwd, ".threenative", "build");
  await mkdir(directory, { recursive: true });
  const artifact = resolvePackagingConfig(cwd, config);
  const output = path.join(directory, "config.json");
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  return output;
}

/**
 * Whether the runtime that will execute this build has WebAssembly.
 *
 * The engine decides it, not the target: V8 compiles WebAssembly, QuickJS and JavaScriptCore do
 * not. A desktop build is for either engine — Linux x64, Windows and macOS use V8, the Linux
 * arm64 lane builds QuickJS over wgpu-native — so the target alone cannot answer it. The runtime
 * binary the packager is handed (`THREENATIVE_RUNTIME_BINARY`, set by the same build invocation)
 * is probed for its engine; absent or unreadable, the answer is the historical desktop one, true,
 * because every published desktop prebuilt runs V8.
 */
export function runtimeHasWebAssembly(
  binary: string | undefined = process.env.THREENATIVE_RUNTIME_BINARY,
  probe: typeof spawnSync = spawnSync,
): boolean {
  if (binary === undefined || !existsSync(binary)) return true;
  let result: ReturnType<typeof spawnSync>;
  try {
    result = probe(binary, ["--version"], { encoding: "utf8" });
  } catch {
    return true;
  }
  if (result.status !== 0) return true;
  const engine = /\+ (\S+) build/u.exec(String(result.stdout ?? ""))?.[1] ?? "";
  // The engine names are CMake's MYSTRAL_JS_ENGINE_NAME: v8, jsc or quickjs. Only V8 runs WASM.
  return !/^(?:quickjs|jsc)$/iu.test(engine);
}

async function bundleNative(
  cwd: string,
  runtimeRoot: string,
  entry: string,
  target: NativeBuildTarget,
  nativeBackend: boolean,
): Promise<string> {
  const output = path.join(cwd, ".threenative", "build", "game.js");
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "bundle.mjs"),
      "--project",
      cwd,
      "--entry",
      entry,
      "--target",
      target,
      "--output",
      output,
      ...(nativeBackend ? ["--native-backend"] : []),
    ],
    cwd,
  );
  return output;
}

/** The one packaging selector, as `runtime-native/scripts/asset-manifest.mjs` exports it. */
interface IPackagingSelector {
  selectManifestAssets(
    assets: string,
    options?: { log?: (line: string) => void },
  ): { dropped: string[]; selected: string[] };
}

/** The one packaging selector, from the installed native runtime; absent when it is not installed. */
async function packagingSelector(cwd: string): Promise<IPackagingSelector | undefined> {
  try {
    const module = path.join(
      packageRoot(cwd, "@threenative/runtime-native"),
      "scripts",
      "asset-manifest.mjs",
    );
    return (await import(pathToFileURL(module).href)) as IPackagingSelector;
  } catch {
    return undefined;
  }
}

/** The bytes of the asset files this build actually packages, and not the ones it drops. */
async function measurePackagedAssetBytes(cwd: string, assets: string): Promise<number> {
  if (!existsSync(assets)) return 0;
  const selector = await packagingSelector(cwd);
  if (selector === undefined) return measureTreeBytes(assets);
  let total = 0;
  // Silent: the packager is seconds away printing these same skips and the unmanaged line.
  for (const file of selector.selectManifestAssets(assets, { log: () => {} }).selected)
    total += (await stat(path.join(assets, file))).size;
  return total;
}

function budgetSentence(metric: string, measured: number, limit: number): string {
  return `threenative build: ${metric} measured ${measured} bytes over its ${limit}-byte limit.`;
}

/**
 * Measure what a staged build produced against its profile's `artifactBudget`, before publishing.
 *
 * An `error` ceiling refuses the build and leaves the previous artifact exactly where it was —
 * the whole reason measurement happens here, on the staging path, and not after the publish.
 * A `warn` ceiling prints the same sentence and publishes, because a game that ships over its own
 * advisory ceiling is a decision its author made.
 */
async function assertArtifactBudget(
  cwd: string,
  config: IResolvedThreeNativeConfig,
  final: string,
  staged: string,
  assets: string,
): Promise<void> {
  const budget = config.buildProfile?.artifactBudget;
  if (budget === undefined) return;
  const metrics = [
    {
      declared: budget.artifactBytes,
      measured: await measureTreeBytes(staged),
      name: "artifactBytes",
    },
    {
      declared: budget.packagedAssetBytes,
      measured: await measurePackagedAssetBytes(cwd, assets),
      name: "packagedAssetBytes",
    },
  ];
  for (const { declared, measured, name } of metrics) {
    if (declared === undefined || measured <= declared.limit) continue;
    const sentence = budgetSentence(name, measured, declared.limit);
    if (declared.severity === "error") {
      throw new Error(
        `TN_BUILD_ARTIFACT_BUDGET_EXCEEDED: ${sentence} The build did not publish, so ${final} is still the previous artifact.`,
      );
    }
    process.stdout.write(`${sentence}\n`);
  }
}

async function buildNative(
  target: NativeBuildTarget,
  cwd: string,
  allowSourceBuild = false,
  mode: BuildMode = "debug",
  format: BuildFormat = "apk",
  profile?: string,
): Promise<void> {
  const config = await loadConfig(cwd, { target, profile });
  announceProfile(config);
  assertNativeUiRendererCompatible(target, config.ui.renderer);
  // A native host without WebAssembly cannot run Rapier as WASM or decode meshopt/KTX2, so it
  // takes the native physics backend and a decoder-free bake. The capability is the runtime
  // engine, not the target: android and iOS are always QuickJS/JSC, and a desktop host is V8
  // except on the Linux arm64 lane. `assertNativeAssetsCompatible` stays below as the backstop.
  const webAssembly = runtimeHasWebAssembly();
  await compileAssets({
    config: config.assets,
    cwd,
    platform: target,
    ...(webAssembly ? {} : { runtimeDecoders: { ktx2: false, meshopt: false } }),
  });
  await assertNativeAssetsCompatible(cwd, target, config);
  const entry = await nativeEntry(cwd, config);
  const orientation = config.display.orientation;
  const configPath = await writePackagingConfig(cwd, config);
  const runtimeRoot = packageRoot(cwd, "@threenative/runtime-native");
  const bundle = await bundleNative(cwd, runtimeRoot, entry, target, !webAssembly);
  await assertNativeBundleCompatible(bundle, target);
  // The compiled root the project configured, which `compileAssets` above baked into — not the
  // `public` default. A project whose cook profile writes elsewhere was packaging an empty
  // directory while its own assets sat next to it, unread.
  const assets = assetRoot(cwd, config);
  // The UI is built only when the game asked for the web renderer, so a `native` game ships no
  // web view, no UI bundle and no extra process — acceptance criterion 5 of PRD-217.
  const ui = config.ui.renderer === "web" ? await buildUi(cwd, config) : undefined;
  if (target === "ios") {
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.app`);
    await packageStaged(
      output,
      runtimeRoot,
      [
        path.join(runtimeRoot, "scripts", "package-ios.mjs"),
        "--bundle",
        bundle,
        "--assets",
        assets,
        ...(ui === undefined ? [] : ["--ui", ui]),
        "--orientation",
        orientation,
        "--config",
        configPath,
        "--output",
        output,
      ],
      { assets, config, target: "ios" },
    );
    return;
  }
  if (target === "android") {
    const output = path.join(
      cwd,
      "dist-native",
      `${await projectName(cwd)}.${format === "aab" ? "aab" : "apk"}`,
    );
    await packageStaged(
      output,
      runtimeRoot,
      [
        path.join(runtimeRoot, "scripts", "package-android.mjs"),
        ...(allowSourceBuild ? ["--allow-source-build"] : []),
        "--mode",
        mode,
        "--format",
        format,
        // The consumer project, so a relative keystore path in the signing environment resolves
        // against the game rather than the engine's Android project.
        "--project-root",
        cwd,
        "--bundle",
        bundle,
        "--assets",
        assets,
        ...(ui === undefined ? [] : ["--ui", ui]),
        "--orientation",
        orientation,
        "--config",
        configPath,
        "--output",
        output,
      ],
      { assets, config, target: "android" },
    );
    return;
  }
  const output = path.join(cwd, "dist-native", await projectName(cwd));
  await packageStaged(
    output,
    cwd,
    [
      path.join(runtimeRoot, "scripts", "package-desktop.mjs"),
      "--mode",
      mode,
      "--bundle",
      bundle,
      "--assets",
      assets,
      ...(ui === undefined ? [] : ["--ui", ui]),
      "--config",
      configPath,
      ...(process.env.THREENATIVE_RUNTIME_BINARY
        ? ["--runtime", path.resolve(process.env.THREENATIVE_RUNTIME_BINARY)]
        : []),
      "--output",
      output,
    ],
    { assets, config, target: "desktop" },
  );
}

/**
 * Run a packager against a staging sibling of the final artifact, then publish what it produced.
 *
 * A packager writes in place: an APK that fails halfway leaves a truncated `dist-native/<name>.apk`
 * where a working one used to be, and a killed build leaves no way to tell the two apart. So the
 * packager is handed `stagingPath(final)`, and only a complete run publishes — a rename aside
 * for the previous artifact, a rename in for the new one, then the old one goes. A failure never
 * reaches the publish, so the previous artifact is still the artifact.
 */
async function packageStaged(
  output: string,
  cwd: string,
  args: readonly string[],
  report?: { assets: string; config: IResolvedThreeNativeConfig; target: BuildTarget },
): Promise<void> {
  const staged = stagingPath(output);
  const index = args.indexOf("--output");
  if (index < 0 || index + 1 >= args.length) {
    throw new Error("packageStaged needs the packager's --output <path> argument to stage it.");
  }
  const packager = [...args];
  packager[index + 1] = staged;
  try {
    await mkdir(path.dirname(staged), { recursive: true });
    await run(process.execPath, packager, cwd);
    if (report !== undefined) {
      const produced = await producedArtifact(staged);
      if (report.config.buildProfile?.artifactBudget !== undefined)
        await assertArtifactBudget(cwd, report.config, output, produced, report.assets);
      await writeBuildReport({
        artifact: produced,
        assets: report.assets,
        config: report.config,
        packagedAssetBytes: await measurePackagedAssetBytes(cwd, report.assets),
        target: report.target,
      });
    }
  } catch (error) {
    await rm(path.dirname(staged), { force: true, recursive: true });
    throw error;
  }
  await publishStagedArtifact(output, staged);
}

/**
 * Where a build stages `final`: a private directory beside it, keeping the artifact's own name.
 *
 * The name matters because packagers derive from it — a desktop release container is named after
 * its output's basename — so a suffixed name would ship inside the artifact. The directory also
 * collects the whole family a packager writes next to its output (`<name>.json` beside an iOS
 * `.app`, `<name>.tar.gz` and `<name>-setup.exe` beside a desktop binary), so publish and cleanup
 * never have to know those spellings.
 */
export function stagingPath(final: string): string {
  return path.join(path.dirname(final), `.staging-${process.pid}`, path.basename(final));
}

/**
 * The file a packager actually wrote for `staged`. Its name is not always the requested one: a
 * Windows executable gains `.exe`, and a desktop release writes only its container
 * (`<name>.tar.gz`, a zipped `.app`), never a bare `<name>`. Exact name first, then the
 * executable and bundle spellings, then the one other thing the packager left beside it.
 */
async function producedArtifact(staged: string): Promise<string> {
  const directory = path.dirname(staged);
  const name = path.basename(staged);
  const entries = existsSync(directory) ? await readdir(directory) : [];
  for (const candidate of [name, `${name}.exe`, `${name}.app`]) {
    if (entries.includes(candidate)) return path.join(directory, candidate);
  }
  const other = entries.filter((entry) => !entry.endsWith(BUILD_REPORT_SUFFIX)).sort()[0];
  if (other === undefined) {
    throw new Error(
      `TN_BUILD_ARTIFACT_MISSING: the packager exited successfully but wrote no artifact to ${staged}.`,
    );
  }
  return path.join(directory, other);
}

/**
 * Publish everything a staging build produced over the artifacts it replaces, then drop the
 * staging directory.
 *
 * Staging and destination share a parent, so each rename is atomic: the window in which an
 * artifact does not exist is a single syscall wide — and a rename that fails puts the previous one
 * back rather than leaving neither. Exported for the test that can only reach this path by making
 * a rename fail.
 */
export async function publishStagedArtifact(final: string, staging: string): Promise<void> {
  const from = path.dirname(staging);
  const produced = existsSync(from) ? await readdir(from) : [];
  if (!produced.some((name) => !name.endsWith(BUILD_REPORT_SUFFIX))) {
    throw new Error(
      `TN_BUILD_ARTIFACT_MISSING: the packager exited successfully but wrote no artifact to ${staging}; ${final} is unchanged.`,
    );
  }
  const directory = path.dirname(final);
  for (const name of produced) {
    const source = path.join(from, name);
    const to = path.join(directory, name);
    if (!existsSync(to)) {
      await rename(source, to);
      continue;
    }
    const previous = path.join(from, `${name}.previous`);
    await rename(to, previous);
    try {
      await rename(source, to);
    } catch (error) {
      // The new artifact did not land, so the previous one goes back: never leave neither.
      await rename(previous, to);
      throw error;
    }
  }
  await rm(from, { force: true, recursive: true });
}

/** The project-scoped build lock, holding the pid of the build that owns it. */
const BUILD_LOCK = path.join(".threenative", "build.lock");

/** Whether a pid is running; `EPERM` is a live process this user may not signal. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Take the project build lock, or fail `TN_BUILD_BUSY` naming the build holding it.
 *
 * `.threenative/build/config.json` and `game.js` are shared mutable paths, so two builds in one
 * project overwrite each other's inputs half-way through. A lock whose pid is gone is reclaimed —
 * a crashed build must not lock a project out forever — and a crash mid-write leaves no pid,
 * which reads the same way.
 */
async function acquireBuildLock(lock: string): Promise<void> {
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number.parseInt((await readFile(lock, "utf8").catch(() => "")).trim(), 10);
      if (Number.isSafeInteger(pid) && pid > 0 && pidAlive(pid)) {
        throw new Error(
          `TN_BUILD_BUSY: another threenative build (pid ${pid}) holds ${lock}. Wait for it to finish; if that process is gone, delete the lock.`,
        );
      }
      // ponytail: two builds reclaiming the same dead lock in the same instant can both win;
      // move to an OS advisory lock if concurrent CI builds of one checkout ever hit it.
      await rm(lock, { force: true });
    }
  }
}

export async function build(options: IBuildOptions): Promise<void> {
  if (options.allowSourceBuild && options.target !== "android") {
    throw new Error("--allow-source-build is supported only for --target android.");
  }
  if (
    (options.mode !== undefined && options.target !== "android" && options.target !== "desktop") ||
    (options.format !== undefined && options.target !== "android")
  ) {
    throw new Error(
      "--mode is supported only for --target android or desktop; --format only for --target android.",
    );
  }
  const mode = options.mode ?? "debug";
  const format = options.format ?? "apk";
  // An app bundle is a Play submission shape; there is no debug AAB to install.
  if (format === "aab" && mode !== "release") {
    throw new Error("--format aab requires --mode release.");
  }
  // Every option is refused before the project is touched, the lock included: a request the
  // build cannot honour must not leave a lock file or a `.threenative/` behind to explain itself.
  if (options.target !== "web" && (options.viteArgs?.length ?? 0) > 0) {
    throw new Error(
      `${options.target} build does not accept ${options.viteArgs?.join(" ")}. iOS output is simulator-only; device signing remains OPEN.`,
    );
  }
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const lock = path.join(cwd, BUILD_LOCK);
  await mkdir(path.dirname(lock), { recursive: true });
  await acquireBuildLock(lock);
  try {
    if (options.target === "web") await buildWeb(cwd, options.viteArgs, options.profile);
    else {
      await buildNative(
        options.target,
        cwd,
        options.allowSourceBuild === true,
        mode,
        format,
        options.profile,
      );
    }
  } finally {
    await rm(lock, { force: true });
  }
}

export function buildHelp(): string {
  return `${[
    "Usage: threenative build [--target web|desktop|android|ios] [--mode debug|release] [--format apk|aab]",
    "",
    "Options:",
    "  --target <target>  Choose web, desktop, android, or ios (default: web).",
    "  --mode <mode>      debug (default) or release. Desktop release wraps the executable in one complete OS container.",
    "  --format <format>  Android only: apk (default) or aab. aab requires --mode release.",
    "  --profile <name>   A buildProfiles name; wins over buildProfiles.defaults for the target.",
    "  --allow-source-build  Explicitly allow Android maintainer source compilation.",
    "  --help             Show this help.",
  ].join("\n")}\n`;
}

export function parseBuildArgs(argv: readonly string[]): IBuildOptions {
  if (argv[0] !== "build") {
    throw new Error("Usage: threenative build [--target web|desktop|android|ios]");
  }
  const targetIndex = argv.indexOf("--target");
  const value = targetIndex === -1 ? "web" : argv[targetIndex + 1];
  if (!TARGETS.includes(value as BuildTarget)) {
    throw new Error(`Unknown build target '${value ?? ""}'. Choose ${TARGETS.join(", ")}.`);
  }
  const allowSourceBuild = argv.includes("--allow-source-build");
  if (allowSourceBuild && value !== "android") {
    throw new Error("--allow-source-build is supported only for --target android.");
  }
  const mode = flagValue(argv, "--mode");
  if (mode !== undefined && mode !== "debug" && mode !== "release") {
    throw new Error(`Unknown build mode '${mode}'. Choose debug or release.`);
  }
  const format = flagValue(argv, "--format");
  if (format !== undefined && format !== "apk" && format !== "aab") {
    throw new Error(`Unknown build format '${format}'. Choose apk or aab.`);
  }
  const profile = flagValue(argv, "--profile");
  if (
    (mode !== undefined && value !== "android" && value !== "desktop") ||
    (format !== undefined && value !== "android")
  ) {
    throw new Error(
      "--mode is supported only for --target android or desktop; --format only for --target android.",
    );
  }
  if (format === "aab" && (mode ?? "debug") !== "release") {
    throw new Error("--format aab requires --mode release.");
  }
  const consumed = new Set([0]);
  if (allowSourceBuild) {
    for (let index = 1; index < argv.length; index += 1) {
      if (argv[index] === "--allow-source-build") consumed.add(index);
    }
  }
  for (const flag of ["--mode", "--format", "--profile"]) {
    for (let index = 1; index < argv.length; index += 1) {
      if (argv[index] === flag) {
        consumed.add(index);
        consumed.add(index + 1);
      }
    }
  }
  if (targetIndex !== -1) {
    consumed.add(targetIndex);
    consumed.add(targetIndex + 1);
  }
  return {
    target: value as BuildTarget,
    ...(allowSourceBuild ? { allowSourceBuild: true } : {}),
    ...(mode === undefined ? {} : { mode: mode as BuildMode }),
    ...(format === undefined ? {} : { format: format as BuildFormat }),
    ...(profile === undefined ? {} : { profile }),
    viteArgs: argv.filter((_, index) => !consumed.has(index)),
  };
}

/** A single-valued long flag, or undefined when absent; a trailing flag with no value throws. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}
