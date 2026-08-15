import { access, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IThreeNativeConfig, ThreeNativeOrientation } from "@threenative/core";

export type { IThreeNativeConfig, ThreeNativeOrientation } from "@threenative/core";

export interface IResolvedThreeNativeConfig {
  readonly app: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly build: number;
    readonly icon?: string;
  };
  readonly display: {
    readonly orientation: ThreeNativeOrientation;
    readonly fullscreen: boolean;
    readonly keepScreenOn: boolean;
  };
  readonly window: {
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly resizable: boolean;
  };
  readonly loading: {
    readonly image?: string;
    readonly backdropColor: string;
    readonly trackColor: string;
    readonly progressColor: string;
    readonly showProgressBar: boolean;
  };
  readonly nativeEntry: string;
  readonly renderer: {
    readonly preferWebGPU: boolean;
  };
}

interface IPackageManifest {
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly name?: unknown;
  readonly optionalDependencies?: unknown;
  readonly version?: unknown;
  readonly threenative?: unknown;
}

type Esbuild = {
  transformSync(
    source: string,
    options: { format: "esm"; loader: "ts"; platform: "node"; target: "node20" },
  ): { code: string };
};

type ConfigLayer = "package manifest" | "config loading" | "config validation";

interface IConfigContext {
  readonly cwd: string;
  readonly fix: string;
  readonly layer: ConfigLayer;
  readonly searched: readonly string[];
  readonly sources: readonly string[];
}

const ORIENTATIONS: readonly ThreeNativeOrientation[] = ["landscape", "portrait", "sensor"];
const CONFIG_FILE = "threenative.config.ts";

class ConfigFailure extends Error {
  readonly code: string;
  readonly context: IConfigContext | undefined;
  readonly detail: string;

  constructor(code: string, detail: string, context?: IConfigContext) {
    super(`${code}: ${context === undefined ? detail : formatContext(context, detail)}`);
    this.name = "ConfigFailure";
    this.code = code;
    this.context = context;
    this.detail = detail;
  }
}

function formatContext(context: IConfigContext, detail: string): string {
  return `${context.layer} layer failed for ${context.sources.map((source) => `'${source}'`).join(", ")} from '${context.cwd}'. Searched: ${context.searched.join(", ")}. ${detail} Fix: ${context.fix}`;
}

function fail(code: string, message: string): never {
  throw new ConfigFailure(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value: unknown, group: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) fail("TN_CONFIG_GROUP_INVALID", `${group} must be an object.`);
  return value;
}

function assertKeys(
  value: Record<string, unknown>,
  group: string,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail("TN_CONFIG_UNKNOWN_KEY", `${group}.${key} is not recognised.`);
  }
}

function nonEmptyString(value: unknown, code: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    fail(code, `${label} must be non-empty.`);
  return value;
}

function booleanValue(value: unknown, fallback: boolean, code: string, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") fail(code, `${label} must be true or false.`);
  return value;
}

function positiveInteger(value: unknown, fallback: number, code: string, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(code, `${label} must be a positive integer.`);
  }
  return value as number;
}

function packageDisplayName(manifest: IPackageManifest): string {
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    fail("TN_CONFIG_PACKAGE_NAME_MISSING", "package.json must declare a non-empty name.");
  }
  const name = manifest.name.replace(/^@[^/]+\//u, "");
  if (name.length === 0) fail("TN_CONFIG_PACKAGE_NAME_MISSING", "package.json name is incomplete.");
  return name;
}

function defaultAppId(name: string): string {
  let segment = name.toLowerCase().replace(/[^a-z0-9]/gu, "") || "game";
  if (!/^[a-z]/u.test(segment)) segment = `game${segment}`;
  return `com.threenative.${segment}`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(value: Buffer): boolean {
  if (value.length < PNG_SIGNATURE.length || !value.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let hasHeader = false;
  let hasData = false;
  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > value.length) return false;
    const type = value.toString("ascii", offset + 4, offset + 8);
    const chunk = value.subarray(offset + 4, offset + 8 + length);
    if (crc32(chunk) !== value.readUInt32BE(offset + 8 + length)) return false;
    if (type === "IHDR") {
      if (hasHeader || length !== 13) return false;
      if (value.readUInt32BE(offset + 8) === 0 || value.readUInt32BE(offset + 12) === 0) {
        return false;
      }
      hasHeader = true;
    } else if (type === "IDAT") {
      hasData = true;
    } else if (type === "IEND") {
      return length === 0 && hasHeader && hasData && chunkEnd === value.length;
    }
    offset = chunkEnd;
  }
  return false;
}

function projectRequire(cwd: string): NodeJS.Require {
  return createRequire(path.join(cwd, "package.json"));
}

function resolveModule(cwd: string, name: string): string | undefined {
  try {
    return projectRequire(cwd).resolve(name);
  } catch {
    return undefined;
  }
}

function configLoaderSearch(cwd: string): readonly string[] {
  return [
    path.join(cwd, "node_modules", "vite"),
    path.join(cwd, "node_modules", "esbuild"),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "esbuild"),
  ];
}

const CONFIG_BUILD_COMMAND = "pnpm exec threenative build --target web";

function configContext(
  cwd: string,
  layer: ConfigLayer,
  sources: readonly string[],
  searched: readonly string[],
  fix: string,
): IConfigContext {
  return { cwd, fix, layer, searched, sources };
}

function packageContext(cwd: string): IConfigContext {
  const packagePath = path.join(cwd, "package.json");
  return configContext(
    cwd,
    "package manifest",
    [packagePath],
    [packagePath],
    `repair '${packagePath}' and rerun ${CONFIG_BUILD_COMMAND}`,
  );
}

function loadingContext(cwd: string, sourcePath: string, fix?: string): IConfigContext {
  return configContext(
    cwd,
    "config loading",
    [sourcePath],
    configLoaderSearch(cwd),
    fix ?? `fix '${sourcePath}' and rerun ${CONFIG_BUILD_COMMAND}`,
  );
}

function validationContext(cwd: string, sources: readonly string[]): IConfigContext {
  return configContext(
    cwd,
    "config validation",
    sources,
    [path.join(cwd, "package.json"), path.join(cwd, CONFIG_FILE)],
    `fix '${path.join(cwd, CONFIG_FILE)}' and rerun ${CONFIG_BUILD_COMMAND}`,
  );
}

function configFailure(code: string, context: IConfigContext, detail: string): never {
  throw new ConfigFailure(code, detail, context);
}

function contextualize(
  error: unknown,
  context: IConfigContext,
  fallbackCode: string,
): ConfigFailure {
  if (error instanceof ConfigFailure && error.context !== undefined) return error;
  if (error instanceof ConfigFailure) return new ConfigFailure(error.code, error.detail, context);
  return new ConfigFailure(
    fallbackCode,
    error instanceof Error ? error.message : String(error),
    context,
  );
}

async function withConfigContext<T>(
  context: IConfigContext,
  fallbackCode: string,
  action: () => Promise<T> | T,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    throw contextualize(error, context, fallbackCode);
  }
}

function resolveEsbuild(cwd: string): string | undefined {
  const require = projectRequire(cwd);
  try {
    return require.resolve("esbuild");
  } catch {
    try {
      const vite = require.resolve("vite");
      return createRequire(vite).resolve("esbuild");
    } catch {
      try {
        return createRequire(import.meta.url).resolve("esbuild");
      } catch {
        return undefined;
      }
    }
  }
}

async function importConfig(cwd: string): Promise<Record<string, unknown> | undefined> {
  const sourcePath = path.join(cwd, CONFIG_FILE);
  try {
    await access(sourcePath);
  } catch {
    return undefined;
  }

  const esbuildPath = resolveEsbuild(cwd);
  if (esbuildPath === undefined) {
    configFailure(
      "TN_CONFIG_TRANSPILER_MISSING",
      loadingContext(
        cwd,
        sourcePath,
        `run pnpm add -D vite in '${cwd}' and rerun ${CONFIG_BUILD_COMMAND}`,
      ),
      "threenative.config.ts needs project-resolved esbuild; install Vite or esbuild.",
    );
  }

  let esbuild: Esbuild;
  try {
    esbuild = projectRequire(cwd)(esbuildPath) as Esbuild;
  } catch (error) {
    configFailure(
      "TN_CONFIG_TRANSPILER_MISSING",
      loadingContext(
        cwd,
        sourcePath,
        `run pnpm install in '${cwd}' and rerun ${CONFIG_BUILD_COMMAND}`,
      ),
      error instanceof Error ? error.message : String(error),
    );
  }

  const context = loadingContext(cwd, sourcePath);
  let source: string;
  try {
    source = await readFile(sourcePath, "utf8");
  } catch (error) {
    configFailure(
      "TN_CONFIG_LOAD_FAILED",
      context,
      error instanceof Error ? error.message : String(error),
    );
  }
  let code: string;
  try {
    code = esbuild.transformSync(source, {
      format: "esm",
      loader: "ts",
      platform: "node",
      target: "node20",
    }).code;
  } catch (error) {
    configFailure(
      "TN_CONFIG_TRANSPILE_FAILED",
      context,
      error instanceof Error ? error.message : String(error),
    );
  }

  const compiledPath = path.join(cwd, `.threenative.config.${process.pid}.${Date.now()}.mjs`);
  try {
    await writeFile(compiledPath, code, "utf8");
  } catch (error) {
    configFailure(
      "TN_CONFIG_LOAD_FAILED",
      context,
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    let module: { default?: unknown };
    try {
      module = (await import(`${pathToFileURL(compiledPath).href}?cache=${Date.now()}`)) as {
        default?: unknown;
      };
    } catch (error) {
      configFailure(
        "TN_CONFIG_LOAD_FAILED",
        context,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!isRecord(module.default)) {
      configFailure(
        "TN_CONFIG_DEFAULT_MISSING",
        context,
        "the config did not default-export an object.",
      );
    }
    return module.default;
  } finally {
    await unlink(compiledPath).catch(() => undefined);
  }
}

async function readManifest(cwd: string): Promise<IPackageManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(cwd, "package.json"), "utf8"));
  } catch (error) {
    fail("TN_CONFIG_PACKAGE_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (!isRecord(parsed)) fail("TN_CONFIG_PACKAGE_INVALID", "package.json must contain an object.");
  return parsed as IPackageManifest;
}

function packageNativeEntry(manifest: IPackageManifest): string | undefined {
  if (manifest.threenative === undefined) return undefined;
  if (!isRecord(manifest.threenative)) {
    fail("TN_CONFIG_PACKAGE_INVALID", "package.json.threenative must be an object.");
  }
  assertKeys(manifest.threenative, "package.json.threenative", ["nativeEntry"]);
  const value = manifest.threenative.nativeEntry;
  if (value === undefined) return undefined;
  return nonEmptyString(value, "TN_NATIVE_ENTRY_MISSING", "package.json.threenative.nativeEntry");
}

function validateNativeEntry(value: unknown, cwd: string): string {
  const entry = nonEmptyString(value, "TN_NATIVE_ENTRY_MISSING", "nativeEntry");
  if (path.isAbsolute(entry)) {
    fail("TN_CONFIG_NATIVE_ENTRY_INVALID", "nativeEntry must be project-relative.");
  }
  const resolved = path.resolve(cwd, entry);
  const relative = path.relative(cwd, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("TN_CONFIG_NATIVE_ENTRY_INVALID", "nativeEntry must stay inside the project.");
  }
  return entry;
}

async function validateApp(
  raw: unknown,
  name: string,
  cwd: string,
): Promise<IResolvedThreeNativeConfig["app"]> {
  const app = assertRecord(raw, "app");
  assertKeys(app, "app", ["id", "name", "version", "build", "icon"]);
  const id =
    app.id === undefined
      ? defaultAppId(name)
      : nonEmptyString(app.id, "TN_CONFIG_APP_ID_INVALID", "app.id");
  if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/u.test(id)) {
    fail("TN_CONFIG_APP_ID_INVALID", "app.id must be a lower-case reverse-DNS identifier.");
  }
  const appName =
    app.name === undefined
      ? name
      : nonEmptyString(app.name, "TN_CONFIG_APP_NAME_INVALID", "app.name");
  const version =
    app.version === undefined
      ? "0.1.13"
      : nonEmptyString(app.version, "TN_CONFIG_APP_VERSION_INVALID", "app.version");
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    fail(
      "TN_CONFIG_APP_VERSION_INVALID",
      "app.version must contain three period-separated integer components.",
    );
  }
  const build = positiveInteger(app.build, 1, "TN_CONFIG_APP_BUILD_INVALID", "app.build");
  if (app.icon === undefined) return { id, name: appName, version, build };

  const icon = nonEmptyString(app.icon, "TN_CONFIG_ICON_INVALID", "app.icon");
  if (path.extname(icon).toLowerCase() !== ".png") {
    fail("TN_CONFIG_ICON_INVALID", "app.icon must point to a PNG file.");
  }
  const iconPath = path.resolve(cwd, icon);
  try {
    const info = await stat(iconPath);
    if (!info.isFile()) fail("TN_CONFIG_ICON_MISSING", `app.icon does not name a file: ${icon}`);
  } catch (error) {
    if (error instanceof ConfigFailure) throw error;
    fail("TN_CONFIG_ICON_MISSING", `app.icon does not exist: ${icon}`);
  }
  let contents: Buffer;
  try {
    contents = await readFile(iconPath);
  } catch (error) {
    fail("TN_CONFIG_ICON_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (!isPng(contents)) {
    fail("TN_CONFIG_ICON_INVALID", `app.icon is not a valid PNG file: ${icon}`);
  }
  return { id, name: appName, version, build, icon };
}

function validateDisplay(raw: unknown): IResolvedThreeNativeConfig["display"] {
  const display = assertRecord(raw, "display");
  assertKeys(display, "display", ["orientation", "fullscreen", "keepScreenOn"]);
  const orientation = display.orientation === undefined ? "landscape" : display.orientation;
  if (
    typeof orientation !== "string" ||
    !ORIENTATIONS.includes(orientation as ThreeNativeOrientation)
  ) {
    fail(
      "TN_NATIVE_ORIENTATION_INVALID",
      "display.orientation must be landscape, portrait, or sensor.",
    );
  }
  return {
    orientation: orientation as ThreeNativeOrientation,
    fullscreen: booleanValue(
      display.fullscreen,
      true,
      "TN_CONFIG_FULLSCREEN_INVALID",
      "display.fullscreen",
    ),
    keepScreenOn: booleanValue(
      display.keepScreenOn,
      false,
      "TN_CONFIG_KEEP_SCREEN_ON_INVALID",
      "display.keepScreenOn",
    ),
  };
}

function validateWindow(raw: unknown, appName: string): IResolvedThreeNativeConfig["window"] {
  const window = assertRecord(raw, "window");
  assertKeys(window, "window", ["title", "width", "height", "resizable"]);
  return {
    title:
      window.title === undefined
        ? appName
        : nonEmptyString(window.title, "TN_CONFIG_WINDOW_TITLE_INVALID", "window.title"),
    width: positiveInteger(window.width, 1280, "TN_CONFIG_WINDOW_WIDTH_INVALID", "window.width"),
    height: positiveInteger(window.height, 720, "TN_CONFIG_WINDOW_HEIGHT_INVALID", "window.height"),
    resizable: booleanValue(
      window.resizable,
      true,
      "TN_CONFIG_WINDOW_RESIZABLE_INVALID",
      "window.resizable",
    ),
  };
}

/**
 * The loading screen's declared values. This validates them and nothing draws them: the screen
 * itself is `src/render/loading.ts` in the generated project, which is the user's file to edit or
 * delete. A look this cannot express is a source edit, not another option here.
 */
function validateLoading(raw: unknown): IResolvedThreeNativeConfig["loading"] {
  const loading = assertRecord(raw, "loading");
  assertKeys(loading, "loading", [
    "image",
    "backdropColor",
    "trackColor",
    "progressColor",
    "showProgressBar",
  ]);
  const color = (value: unknown, fallback: string, label: string): string => {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) {
      fail("TN_CONFIG_LOADING_COLOR_INVALID", `${label} must be a #rrggbb colour.`);
    }
    return value as string;
  };
  const image =
    loading.image === undefined
      ? undefined
      : nonEmptyString(loading.image, "TN_CONFIG_LOADING_IMAGE_INVALID", "loading.image");
  if (image !== undefined && path.isAbsolute(image)) {
    fail("TN_CONFIG_LOADING_IMAGE_INVALID", "loading.image must be project-relative.");
  }
  return {
    ...(image === undefined ? {} : { image }),
    backdropColor: color(loading.backdropColor, "#0d1b2a", "loading.backdropColor"),
    trackColor: color(loading.trackColor, "#274060", "loading.trackColor"),
    progressColor: color(loading.progressColor, "#8fd694", "loading.progressColor"),
    showProgressBar: booleanValue(
      loading.showProgressBar,
      true,
      "TN_CONFIG_LOADING_BAR_INVALID",
      "loading.showProgressBar",
    ),
  };
}

function validateRenderer(raw: unknown): IResolvedThreeNativeConfig["renderer"] {
  const renderer = assertRecord(raw, "renderer");
  assertKeys(renderer, "renderer", ["preferWebGPU"]);
  return {
    preferWebGPU: booleanValue(
      renderer.preferWebGPU,
      true,
      "TN_CONFIG_RENDERER_INVALID",
      "renderer.preferWebGPU",
    ),
  };
}

async function loadConfigInternal(root: string): Promise<IResolvedThreeNativeConfig> {
  const packagePath = path.join(root, "package.json");
  const sourcePath = path.join(root, CONFIG_FILE);
  const manifest = await withConfigContext(packageContext(root), "TN_CONFIG_PACKAGE_INVALID", () =>
    readManifest(root),
  );
  const name = await withConfigContext(packageContext(root), "TN_CONFIG_PACKAGE_INVALID", () =>
    packageDisplayName(manifest),
  );
  const packageEntry = await withConfigContext(
    packageContext(root),
    "TN_CONFIG_PACKAGE_INVALID",
    () => packageNativeEntry(manifest),
  );
  const raw = await importConfig(root);
  const sources = packageEntry === undefined ? [sourcePath] : [sourcePath, packagePath];
  return withConfigContext(
    validationContext(root, sources),
    "TN_CONFIG_VALIDATION_FAILED",
    async () => {
      if (raw !== undefined) {
        assertKeys(raw, "config", [
          "app",
          "display",
          "loading",
          "window",
          "nativeEntry",
          "renderer",
        ]);
      }
      const configuredEntry = raw?.nativeEntry;
      if (configuredEntry !== undefined && packageEntry !== undefined) {
        fail(
          "TN_CONFIG_CONFLICT",
          "nativeEntry is declared in both threenative.config.ts and package.json.",
        );
      }
      const app = await validateApp(raw?.app, name, root);
      return {
        app,
        display: validateDisplay(raw?.display),
        loading: validateLoading(raw?.loading),
        window: validateWindow(raw?.window, app.name),
        nativeEntry: validateNativeEntry(configuredEntry ?? packageEntry ?? "src/game.ts", root),
        renderer: validateRenderer(raw?.renderer),
      };
    },
  );
}

export async function loadConfig(cwd: string): Promise<IResolvedThreeNativeConfig> {
  const root = path.resolve(cwd);
  return withConfigContext(
    validationContext(root, [path.join(root, CONFIG_FILE), path.join(root, "package.json")]),
    "TN_CONFIG_VALIDATION_FAILED",
    () => loadConfigInternal(root),
  );
}
