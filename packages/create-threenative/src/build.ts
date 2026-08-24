import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { compileAssets } from "@threenative/assets";
import { type IResolvedThreeNativeConfig, loadConfig } from "./config.js";

export type BuildTarget = "android" | "desktop" | "ios" | "web";
type NativeBuildTarget = Exclude<BuildTarget, "web">;
export type NativeOrientation = IResolvedThreeNativeConfig["display"]["orientation"];

export interface IBuildOptions {
  cwd?: string;
  target: BuildTarget;
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
    throw new Error(
      `Cannot build a native target because '${packageName}' is not installed in ${cwd}.`,
    );
  }
}

function executable(cwd: string, name: string): string {
  const suffix = process.platform === "win32" ? ".cmd" : "";
  return path.join(cwd, "node_modules", ".bin", `${name}${suffix}`);
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
  const outputRoot = path.resolve(cwd, config.assets?.output ?? "public");
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
      `TN_NATIVE_KTX2_UNSUPPORTED: ${target} cannot ship compiled KTX2 textures (${namedAssets(ktx2)}). The mobile native runtime has no WebAssembly and therefore no Basis transcoder, so nothing in the bundle can decode them. Set assets.textures to "none" so native builds ship the source textures, or keep the compressed textures on the web target.`,
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
      `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED: ${target} cannot ship compressed model geometry (${namedAssets(compressedModels)}). The mobile native runtime has no WebAssembly and therefore no Meshopt or Draco decoder. Set assets.models to "none" so native builds ship uncompressed geometry, or keep the compressed models on the web target.`,
    );
  }
}

/** The one UI entry every target mounts. Convention, not configuration. */
const UI_ENTRY = path.join("src", "ui", "main.tsx");

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
  const page = path.join(buildRoot, "ui.html");
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
  await run(process.execPath, [driver], cwd);
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
    "    build: {",
    `      outDir: ${literal(output)},`,
    "      emptyOutDir: true,",
    `      rollupOptions: { input: ${literal(page)} },`,
    "    },",
    "  }),",
    ");",
  ].join("\n")}\n`;
}

export async function buildWeb(cwd: string, viteArgs: readonly string[] = []): Promise<void> {
  const config = await loadConfig(cwd);
  await compileAssets({ config: config.assets, cwd });
  await run(executable(cwd, "vite"), ["build", ...viteArgs], cwd);
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

async function bundleNative(
  cwd: string,
  runtimeRoot: string,
  entry: string,
  target: NativeBuildTarget,
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
    ],
    cwd,
  );
  return output;
}

function installedRuntime(runtimeRoot: string): string {
  if (process.env.THREENATIVE_RUNTIME_BINARY)
    return path.resolve(process.env.THREENATIVE_RUNTIME_BINARY);
  const key = `${process.platform}-${process.arch}`;
  const filename = process.platform === "win32" ? "threenative-runtime.exe" : "threenative-runtime";
  return path.join(runtimeRoot, "prebuilt", key, filename);
}

async function buildNative(target: NativeBuildTarget, cwd: string): Promise<void> {
  const config = await loadConfig(cwd);
  await compileAssets({ config: config.assets, cwd });
  await assertNativeAssetsCompatible(cwd, target, config);
  const entry = await nativeEntry(cwd, config);
  const orientation = config.display.orientation;
  const configPath = await writePackagingConfig(cwd, config);
  const runtimeRoot = packageRoot(cwd, "@threenative/runtime-native");
  const bundle = await bundleNative(cwd, runtimeRoot, entry, target);
  await assertNativeBundleCompatible(bundle, target);
  const assets = path.join(cwd, "public");
  // The UI is built only when the game asked for the web renderer, so a `native` game ships no
  // web view, no UI bundle and no extra process — acceptance criterion 5 of PRD-217.
  const ui = config.ui.renderer === "web" ? await buildUi(cwd, config) : undefined;
  if (target === "ios") {
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.app`);
    await run(
      process.execPath,
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
      runtimeRoot,
    );
    return;
  }
  if (target === "android") {
    const output = path.join(cwd, "dist-native", `${await projectName(cwd)}.apk`);
    await run(
      process.execPath,
      [
        path.join(runtimeRoot, "scripts", "package-android.mjs"),
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
      runtimeRoot,
    );
    return;
  }
  const output = path.join(cwd, "dist-native", await projectName(cwd));
  await run(
    process.execPath,
    [
      path.join(runtimeRoot, "scripts", "package-desktop.mjs"),
      "--bundle",
      bundle,
      "--assets",
      assets,
      ...(ui === undefined ? [] : ["--ui", ui]),
      "--config",
      configPath,
      "--runtime",
      installedRuntime(runtimeRoot),
      "--output",
      output,
    ],
    cwd,
  );
}

export async function build(options: IBuildOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  if (options.target === "web") await buildWeb(cwd, options.viteArgs);
  else {
    if ((options.viteArgs?.length ?? 0) > 0) {
      throw new Error(
        `${options.target} build does not accept ${options.viteArgs?.join(" ")}. iOS output is simulator-only; device signing remains OPEN.`,
      );
    }
    await buildNative(options.target, cwd);
  }
}

export function buildHelp(): string {
  return `${[
    "Usage: threenative build [--target web|desktop|android|ios]",
    "",
    "Options:",
    "  --target <target>  Choose web, desktop, android, or ios (default: web).",
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
  const consumed = new Set([0]);
  if (targetIndex !== -1) {
    consumed.add(targetIndex);
    consumed.add(targetIndex + 1);
  }
  return {
    target: value as BuildTarget,
    viteArgs: argv.filter((_, index) => !consumed.has(index)),
  };
}
