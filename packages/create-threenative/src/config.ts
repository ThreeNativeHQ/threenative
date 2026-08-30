import { access, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parsePng } from "@threenative/assets";
import type {
  IThreeNativeBootSplash,
  IThreeNativeConfig,
  IThreeNativeIconVariants,
  IThreeNativeTexturesConfig,
  ThreeNativeOrientation,
  ThreeNativeUiRenderer,
} from "@threenative/core";

export type {
  IThreeNativeConfig,
  IThreeNativeTexturesConfig,
  ThreeNativeOrientation,
  ThreeNativeUiRenderer,
} from "@threenative/core";

export interface IResolvedThreeNativeConfig {
  readonly app: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly build: number;
    readonly icon?: string;
    readonly icons?: IThreeNativeIconVariants;
  };
  readonly display: {
    readonly orientation: ThreeNativeOrientation;
    readonly fullscreen: boolean;
    readonly keepScreenOn: boolean;
    readonly maxFps: number;
  };
  readonly window: {
    readonly title: string;
    readonly width: number;
    readonly height: number;
    readonly resizable: boolean;
  };
  readonly bootSplash?: IThreeNativeBootSplash;
  readonly nativeEntry: string;
  readonly renderer: {
    readonly preferWebGPU: boolean;
    readonly resolutionScale?: number | "auto";
    readonly antialias?: boolean;
    readonly android?: {
      readonly resolutionScale?: number | "auto";
      readonly antialias?: boolean;
    };
  };
  readonly ui: {
    readonly renderer: ThreeNativeUiRenderer;
  };
  readonly assets?: {
    readonly models?: "none" | IThreeNativeModelsConfig;
    readonly output?: string;
    readonly source?: string;
    readonly targets?: {
      readonly maxMaterials?: number;
      readonly maxTriangles?: number;
      readonly maxTextureDimension?: number;
    };
    /** Texture compression options, or `"none"` to ship every texture exactly as committed. */
    readonly textures?: "none" | IThreeNativeTexturesConfig;
  };
}

/** Model optimization sub-pass switches; absent means every pass runs. */
export interface IThreeNativeModelPassesConfig {
  readonly dedup?: boolean;
  readonly meshopt?: boolean;
  readonly prune?: boolean;
  readonly quantize?: boolean;
  readonly reorder?: boolean;
}

export interface IThreeNativeModelsConfig {
  readonly lightmap?: {
    readonly atlasSize: number;
    readonly padding: number;
  };
  readonly passes?: IThreeNativeModelPassesConfig;
  readonly quantize?: {
    /** Normal precision in bits, default 8. */
    readonly normalBits?: number;
    /** Position precision in bits, default 16. */
    readonly positionBits?: number;
    /** UV precision in bits, default 12. */
    readonly uvBits?: number;
  };
  /**
   * Embedded-texture compression for images carried inside a `.glb`.
   *
   * On by default in the compile step; `"none"` ships every embedded image exactly as
   * authored. `maxSize` caps the longest edge, preserving aspect and snapping to whole 4x4
   * blocks, and never upscales.
   */
  readonly textures?:
    | "none"
    | {
        readonly maxSize?: number;
        readonly quality?: number;
        readonly overrides?: readonly {
          readonly slot: string;
          readonly codec: "etc1s" | "none" | "uastc";
        }[];
      };
  /**
   * Mesh simplification. Absent means none at all, which is the default.
   *
   * `ratio` is the fraction of triangles to keep. `error` is a quality guard rather than a
   * target — the largest a vertex may move as a fraction of the mesh's extent — so a loose
   * ratio with a tight error stops short, and the compile step reports the ratio it actually
   * achieved next to the one that was asked for.
   */
  readonly simplify?: {
    readonly ratio: number;
    readonly error?: number;
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

function maxFpsValue(value: unknown): number {
  if (value === undefined) return 60;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1000) {
    fail(
      "TN_CONFIG_MAX_FPS_INVALID",
      "display.maxFps must be a whole number between 0 (uncapped) and 1000.",
    );
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
        `run pnpm add -D esbuild in '${cwd}' and rerun ${CONFIG_BUILD_COMMAND}`,
      ),
      // Not "install Vite": Vite 8 dropped esbuild for rolldown, so a project on it satisfies the
      // old advice and still lands here. The templates ship esbuild explicitly for this reason;
      // projects scaffolded before that do not.
      "threenative.config.ts needs project-resolved esbuild; install esbuild.",
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
  assertKeys(app, "app", ["id", "name", "version", "build", "icon", "icons"]);
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
  const icon =
    app.icon === undefined
      ? undefined
      : await validateProjectAsset(app.icon, cwd, "app.icon", {
          codePrefix: "TN_CONFIG_ICON",
          formats: ["png"],
          square: true,
        });
  const icons = await validateIconVariants(app.icons, cwd);
  if (
    icons?.android !== undefined &&
    icon === undefined &&
    icons.android.foreground === undefined
  ) {
    fail(
      "TN_CONFIG_BRAND_ANDROID_FOREGROUND_MISSING",
      "app.icons.android.foreground is required when app.icon is not declared.",
    );
  }
  return {
    id,
    name: appName,
    version,
    build,
    ...(icon === undefined ? {} : { icon }),
    ...(icons === undefined ? {} : { icons }),
  };
}

type BrandFormat = "png" | "svg";

interface IProjectAssetOptions {
  readonly codePrefix: string;
  readonly formats: readonly BrandFormat[];
  readonly requiresAlpha?: boolean;
  readonly square?: boolean;
}

async function validateProjectAsset(
  raw: unknown,
  cwd: string,
  label: string,
  options: IProjectAssetOptions,
): Promise<string> {
  const relative = nonEmptyString(raw, `${options.codePrefix}_INVALID`, label);
  if (path.isAbsolute(relative)) {
    fail(`${options.codePrefix}_PATH_INVALID`, `${label} must be project-relative: ${relative}`);
  }
  const resolved = path.resolve(cwd, relative);
  const withinProject = path.relative(cwd, resolved);
  if (
    withinProject === ".." ||
    withinProject.startsWith(`..${path.sep}`) ||
    path.isAbsolute(withinProject)
  ) {
    fail(
      `${options.codePrefix}_PATH_INVALID`,
      `${label} must stay inside the project: ${relative}`,
    );
  }
  const extension = path.extname(relative).slice(1).toLowerCase() as BrandFormat;
  if (!options.formats.includes(extension)) {
    fail(
      options.codePrefix === "TN_CONFIG_ICON"
        ? `${options.codePrefix}_INVALID`
        : `${options.codePrefix}_FORMAT_INVALID`,
      `${label} must use ${options.formats.map((format) => `.${format}`).join(" or ")}: ${relative}`,
    );
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved);
  } catch {
    fail(`${options.codePrefix}_MISSING`, `${label} does not exist: ${relative}`);
  }
  if (!info.isFile()) fail(`${options.codePrefix}_MISSING`, `${label} is not a file: ${relative}`);
  let contents: Buffer;
  try {
    contents = await readFile(resolved);
  } catch (error) {
    fail(
      `${options.codePrefix}_INVALID`,
      `${label} could not be read at ${relative}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (extension === "svg") {
    if (!/<svg(?:\s|>)/iu.test(contents.toString("utf8"))) {
      fail(`${options.codePrefix}_INVALID`, `${label} is not a valid SVG file: ${relative}`);
    }
    return relative;
  }
  const png = parsePng(contents);
  if (png === undefined) {
    fail(`${options.codePrefix}_INVALID`, `${label} is not a valid PNG file: ${relative}`);
  }
  if (options.square === true && png.width !== png.height) {
    fail(
      `${options.codePrefix}_DIMENSIONS_INVALID`,
      `${label} must be square (${png.width}x${png.height}): ${relative}`,
    );
  }
  if (options.requiresAlpha === true && !png.hasAlpha) {
    fail(
      `${options.codePrefix}_ALPHA_INVALID`,
      `${label} must include an alpha channel: ${relative}`,
    );
  }
  return relative;
}

function validateBrandColor(raw: unknown, label: string): string {
  if (typeof raw !== "string" || !/^#[0-9a-f]{6}$/iu.test(raw)) {
    fail("TN_CONFIG_BRAND_COLOR_INVALID", `${label} must be a #rrggbb colour.`);
  }
  return raw;
}

async function validateIconVariants(
  raw: unknown,
  cwd: string,
): Promise<IThreeNativeIconVariants | undefined> {
  if (raw === undefined) return undefined;
  const icons = assertRecord(raw, "app.icons");
  assertKeys(icons, "app.icons", ["android", "ios", "web"]);
  const android =
    icons.android === undefined ? undefined : assertRecord(icons.android, "app.icons.android");
  const ios = icons.ios === undefined ? undefined : assertRecord(icons.ios, "app.icons.ios");
  const web = icons.web === undefined ? undefined : assertRecord(icons.web, "app.icons.web");
  if (android !== undefined)
    assertKeys(android, "app.icons.android", ["foreground", "background", "monochrome"]);
  if (ios !== undefined) assertKeys(ios, "app.icons.ios", ["dark", "tinted"]);
  if (web !== undefined)
    assertKeys(web, "app.icons.web", ["favicon", "maskable", "monochrome", "appleTouch"]);
  const androidResult =
    android === undefined
      ? undefined
      : {
          ...(android.foreground === undefined
            ? {}
            : {
                foreground: await validateProjectAsset(
                  android.foreground,
                  cwd,
                  "app.icons.android.foreground",
                  {
                    codePrefix: "TN_CONFIG_BRAND_ANDROID_FOREGROUND",
                    formats: ["png"],
                    requiresAlpha: true,
                    square: true,
                  },
                ),
              }),
          ...(android.background === undefined
            ? {}
            : {
                background: validateBrandColor(android.background, "app.icons.android.background"),
              }),
          ...(android.monochrome === undefined
            ? {}
            : {
                monochrome: await validateProjectAsset(
                  android.monochrome,
                  cwd,
                  "app.icons.android.monochrome",
                  {
                    codePrefix: "TN_CONFIG_BRAND_ANDROID_MONOCHROME",
                    formats: ["png"],
                    requiresAlpha: true,
                    square: true,
                  },
                ),
              }),
        };
  const iosResult =
    ios === undefined
      ? undefined
      : {
          ...(ios.dark === undefined
            ? {}
            : {
                dark: await validateProjectAsset(ios.dark, cwd, "app.icons.ios.dark", {
                  codePrefix: "TN_CONFIG_BRAND_IOS_DARK",
                  formats: ["png"],
                  square: true,
                }),
              }),
          ...(ios.tinted === undefined
            ? {}
            : {
                tinted: await validateProjectAsset(ios.tinted, cwd, "app.icons.ios.tinted", {
                  codePrefix: "TN_CONFIG_BRAND_IOS_TINTED",
                  formats: ["png"],
                  square: true,
                }),
              }),
        };
  const webResult =
    web === undefined
      ? undefined
      : {
          ...(web.favicon === undefined
            ? {}
            : {
                favicon: await validateProjectAsset(web.favicon, cwd, "app.icons.web.favicon", {
                  codePrefix: "TN_CONFIG_BRAND_WEB_FAVICON",
                  formats: ["png", "svg"],
                  square: true,
                }),
              }),
          ...(web.maskable === undefined
            ? {}
            : {
                maskable: await validateProjectAsset(web.maskable, cwd, "app.icons.web.maskable", {
                  codePrefix: "TN_CONFIG_BRAND_WEB_MASKABLE",
                  formats: ["png"],
                  square: true,
                }),
              }),
          ...(web.monochrome === undefined
            ? {}
            : {
                monochrome: await validateProjectAsset(
                  web.monochrome,
                  cwd,
                  "app.icons.web.monochrome",
                  {
                    codePrefix: "TN_CONFIG_BRAND_WEB_MONOCHROME",
                    formats: ["png"],
                    square: true,
                  },
                ),
              }),
          ...(web.appleTouch === undefined
            ? {}
            : {
                appleTouch: await validateProjectAsset(
                  web.appleTouch,
                  cwd,
                  "app.icons.web.appleTouch",
                  {
                    codePrefix: "TN_CONFIG_BRAND_WEB_APPLE_TOUCH",
                    formats: ["png"],
                    square: true,
                  },
                ),
              }),
        };
  return {
    ...(androidResult === undefined ? {} : { android: androidResult }),
    ...(iosResult === undefined ? {} : { ios: iosResult }),
    ...(webResult === undefined ? {} : { web: webResult }),
  };
}

function validateDisplay(raw: unknown): IResolvedThreeNativeConfig["display"] {
  const display = assertRecord(raw, "display");
  assertKeys(display, "display", ["orientation", "fullscreen", "keepScreenOn", "maxFps"]);
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
    maxFps: maxFpsValue(display.maxFps),
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

async function validateBootSplash(
  raw: unknown,
  cwd: string,
): Promise<IResolvedThreeNativeConfig["bootSplash"]> {
  if (raw === undefined) return undefined;
  const bootSplash = assertRecord(raw, "bootSplash");
  assertKeys(bootSplash, "bootSplash", ["backgroundColor", "image"]);
  const backgroundColor =
    bootSplash.backgroundColor === undefined
      ? undefined
      : validateBrandColor(bootSplash.backgroundColor, "bootSplash.backgroundColor");
  const image =
    bootSplash.image === undefined
      ? undefined
      : await validateProjectAsset(bootSplash.image, cwd, "bootSplash.image", {
          codePrefix: "TN_CONFIG_BRAND_SPLASH",
          formats: ["png"],
        });
  return {
    ...(backgroundColor === undefined ? {} : { backgroundColor }),
    ...(image === undefined ? {} : { image }),
  };
}

/** Which renderer draws `src/ui/`. @see IThreeNativeConfig.ui */
const UI_RENDERERS: readonly ThreeNativeUiRenderer[] = ["native", "web"];

/**
 * The public surface is exactly two words. Which web view a `"web"` game lands on — and whether
 * a platform composites a sibling layer or renders to a texture — is the host's business, so a
 * typo here fails naming the two valid values rather than defaulting to one of them.
 */
function validateUi(raw: unknown): IResolvedThreeNativeConfig["ui"] {
  const ui = assertRecord(raw, "ui");
  assertKeys(ui, "ui", ["renderer"]);
  const renderer = ui.renderer === undefined ? "native" : ui.renderer;
  if (typeof renderer !== "string" || !UI_RENDERERS.includes(renderer as ThreeNativeUiRenderer)) {
    fail("TN_CONFIG_UI_RENDERER_INVALID", "ui.renderer must be web or native.");
  }
  return { renderer: renderer as ThreeNativeUiRenderer };
}

function validateRenderer(raw: unknown): IResolvedThreeNativeConfig["renderer"] {
  const renderer = assertRecord(raw, "renderer");
  assertKeys(renderer, "renderer", ["preferWebGPU", "resolutionScale", "antialias", "android"]);
  const android = assertRecord(renderer.android, "renderer.android");
  assertKeys(android, "renderer.android", ["resolutionScale", "antialias"]);
  const resolutionScale = renderer.resolutionScale;
  const androidResolutionScale = android.resolutionScale;
  // The same rule the engine enforces at `resolveRendererScaleSetting`, stated here so a game
  // learns it from a named config failure rather than from a renderer that throws mid-boot:
  // "auto", or a number in (0, 1]. Above one asks for a buffer larger than the surface.
  for (const [name, value] of [
    ["renderer.resolutionScale", resolutionScale],
    ["renderer.android.resolutionScale", androidResolutionScale],
  ] as const) {
    if (value === undefined || value === "auto") continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
      fail(
        "TN_CONFIG_RENDERER_RESOLUTION_SCALE_INVALID",
        `${name} must be "auto" or a number within (0, 1].`,
      );
    }
  }
  const antialias = booleanOrUndefined(renderer.antialias, "renderer.antialias");
  const androidAntialias = booleanOrUndefined(android.antialias, "renderer.android.antialias");
  const androidOverrides = {
    ...(androidResolutionScale === undefined
      ? {}
      : { resolutionScale: androidResolutionScale as number | "auto" }),
    ...(androidAntialias === undefined ? {} : { antialias: androidAntialias }),
  };
  return {
    preferWebGPU: booleanValue(
      renderer.preferWebGPU,
      true,
      "TN_CONFIG_RENDERER_INVALID",
      "renderer.preferWebGPU",
    ),
    ...(antialias === undefined ? {} : { antialias }),
    ...(resolutionScale === undefined
      ? {}
      : { resolutionScale: resolutionScale as number | "auto" }),
    ...(Object.keys(androidOverrides).length === 0 ? {} : { android: androidOverrides }),
  };
}

function booleanOrUndefined(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") fail("TN_CONFIG_RENDERER_INVALID", `${name} must be a boolean.`);
  return value as boolean;
}

const ASSET_TARGET_KEYS: readonly string[] = [
  "maxMaterials",
  "maxTriangles",
  "maxTextureDimension",
];

function validateAssetTargets(
  raw: unknown,
): NonNullable<IResolvedThreeNativeConfig["assets"]>["targets"] {
  const targets = assertRecord(raw, "assets.targets");
  assertKeys(targets, "assets.targets", ASSET_TARGET_KEYS);
  return {
    ...(targets.maxMaterials === undefined
      ? {}
      : {
          maxMaterials: positiveInteger(
            targets.maxMaterials,
            1,
            "TN_CONFIG_ASSETS_INVALID",
            "assets.targets.maxMaterials",
          ),
        }),
    ...(targets.maxTriangles === undefined
      ? {}
      : {
          maxTriangles: positiveInteger(
            targets.maxTriangles,
            1,
            "TN_CONFIG_ASSETS_INVALID",
            "assets.targets.maxTriangles",
          ),
        }),
    ...(targets.maxTextureDimension === undefined
      ? {}
      : {
          maxTextureDimension: positiveInteger(
            targets.maxTextureDimension,
            1,
            "TN_CONFIG_ASSETS_INVALID",
            "assets.targets.maxTextureDimension",
          ),
        }),
  };
}

const ASSET_TEXTURE_KEYS: readonly string[] = ["overrides", "quality"];
const TEXTURE_OVERRIDE_KEYS: readonly string[] = ["codec", "glob", "quality"];
const TEXTURE_CODECS: readonly string[] = ["etc1s", "none", "uastc"];

function textureQuality(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 255) {
    fail("TN_CONFIG_ASSETS_INVALID", `${label} must be an integer between 1 and 255.`);
  }
  return value;
}

function validateTextureOverrides(
  raw: unknown,
): NonNullable<IThreeNativeTexturesConfig["overrides"]> {
  if (!Array.isArray(raw)) {
    fail("TN_CONFIG_ASSETS_INVALID", "assets.textures.overrides must be an array.");
  }
  return raw.map((item, index) => {
    if (!isRecord(item)) {
      fail(
        "TN_CONFIG_ASSETS_INVALID",
        `assets.textures.overrides[${String(index)}] must be an object.`,
      );
    }
    assertKeys(item, `assets.textures.overrides[${String(index)}]`, TEXTURE_OVERRIDE_KEYS);
    const glob = nonEmptyString(
      item.glob,
      "TN_CONFIG_ASSETS_INVALID",
      `assets.textures.overrides[${String(index)}].glob`,
    );
    if (typeof item.codec !== "string" || !TEXTURE_CODECS.includes(item.codec)) {
      fail(
        "TN_CONFIG_ASSETS_INVALID",
        `assets.textures.overrides[${String(index)}].codec must be one of ${TEXTURE_CODECS.join(", ")}; received '${String(item.codec)}'.`,
      );
    }
    return {
      codec: item.codec as "etc1s" | "none" | "uastc",
      glob,
      ...(item.quality === undefined
        ? {}
        : {
            quality: textureQuality(
              item.quality,
              `assets.textures.overrides[${String(index)}].quality`,
            ),
          }),
    };
  });
}

function validateTextures(
  raw: unknown,
): NonNullable<IResolvedThreeNativeConfig["assets"]>["textures"] {
  if (raw === "none") return "none";
  const textures = assertRecord(raw, "assets.textures");
  assertKeys(textures, "assets.textures", ASSET_TEXTURE_KEYS);
  return {
    ...(textures.quality === undefined
      ? {}
      : { quality: textureQuality(textures.quality, "assets.textures.quality") }),
    ...(textures.overrides === undefined
      ? {}
      : { overrides: validateTextureOverrides(textures.overrides) }),
  };
}

const MODEL_PASS_KEYS: readonly string[] = ["dedup", "meshopt", "prune", "quantize", "reorder"];
const MODEL_QUANTIZE_KEYS: readonly string[] = ["normalBits", "positionBits", "uvBits"];

function bitDepth(value: unknown, label: string): number {
  // Depths low enough to warp a model are accepted, not rejected: the compile step's own
  // self-verification fails the build naming the drift instead of a config rule guessing.
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > 16) {
    fail("TN_CONFIG_ASSETS_INVALID", `${label} must be an integer between 1 and 16 bits.`);
  }
  return value;
}

function validateModels(raw: unknown): NonNullable<IResolvedThreeNativeConfig["assets"]>["models"] {
  if (raw === "none") return "none";
  const models = assertRecord(raw, "assets.models");
  assertKeys(models, "assets.models", ["lightmap", "passes", "quantize", "simplify", "textures"]);
  let lightmap: IThreeNativeModelsConfig["lightmap"];
  if (models.lightmap !== undefined) {
    const rawLightmap = assertRecord(models.lightmap, "assets.models.lightmap");
    assertKeys(rawLightmap, "assets.models.lightmap", ["atlasSize", "padding"]);
    if (rawLightmap.atlasSize === undefined || rawLightmap.padding === undefined) {
      fail("TN_CONFIG_ASSETS_INVALID", "assets.models.lightmap requires atlasSize and padding.");
    }
    lightmap = {
      atlasSize: positiveInteger(
        rawLightmap.atlasSize,
        1,
        "TN_CONFIG_ASSETS_INVALID",
        "assets.models.lightmap.atlasSize",
      ),
      padding: positiveInteger(
        rawLightmap.padding,
        1,
        "TN_CONFIG_ASSETS_INVALID",
        "assets.models.lightmap.padding",
      ),
    };
  }
  let passes: IThreeNativeModelPassesConfig | undefined;
  if (models.passes !== undefined) {
    const rawPasses = assertRecord(models.passes, "assets.models.passes");
    assertKeys(rawPasses, "assets.models.passes", MODEL_PASS_KEYS);
    passes = {};
    for (const key of MODEL_PASS_KEYS) {
      const value = rawPasses[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean")
        fail("TN_CONFIG_ASSETS_INVALID", `assets.models.passes.${key} must be true or false.`);
      passes = { ...passes, [key]: value } as IThreeNativeModelPassesConfig;
    }
  }
  let quantize: IThreeNativeModelsConfig["quantize"];
  if (models.quantize !== undefined) {
    const rawQuantize = assertRecord(models.quantize, "assets.models.quantize");
    assertKeys(rawQuantize, "assets.models.quantize", MODEL_QUANTIZE_KEYS);
    quantize = {};
    for (const key of MODEL_QUANTIZE_KEYS) {
      const value = rawQuantize[key];
      if (value === undefined) continue;
      quantize = {
        ...quantize,
        [key]: bitDepth(value, `assets.models.quantize.${key}`),
      } as IThreeNativeModelsConfig["quantize"];
    }
  }
  // Embedded-texture compression and simplification are validated by the asset pipeline
  // itself, which owns their shapes and reports TN_ASSETS_CONFIG_* for anything malformed.
  // Both are passed through rather than re-parsed here, because a second hand-written parser
  // for the same keys is exactly how the two `IThreeNativeModelsConfig` declarations in this
  // repo drifted apart in the first place: the pipeline grew `textures` and `simplify`, and
  // neither this validator nor its type knew, so a project literally could not declare a
  // feature the compile step already supported.
  const simplify = models.simplify as IThreeNativeModelsConfig["simplify"];
  const textures = models.textures as IThreeNativeModelsConfig["textures"];
  return {
    ...(lightmap === undefined ? {} : { lightmap }),
    ...(passes === undefined || Object.keys(passes).length === 0 ? {} : { passes }),
    ...(quantize === undefined || Object.keys(quantize).length === 0 ? {} : { quantize }),
    ...(simplify === undefined ? {} : { simplify }),
    ...(textures === undefined ? {} : { textures }),
  };
}

function validateAssets(raw: unknown): IResolvedThreeNativeConfig["assets"] {
  const assets = assertRecord(raw, "assets");
  assertKeys(assets, "assets", ["models", "source", "output", "targets", "textures"]);
  const targets = assets.targets === undefined ? undefined : validateAssetTargets(assets.targets);
  const models = assets.models === undefined ? undefined : validateModels(assets.models);
  const textures = assets.textures === undefined ? undefined : validateTextures(assets.textures);
  return {
    ...(assets.source === undefined
      ? {}
      : { source: nonEmptyString(assets.source, "TN_CONFIG_ASSETS_INVALID", "assets.source") }),
    ...(assets.output === undefined
      ? {}
      : { output: nonEmptyString(assets.output, "TN_CONFIG_ASSETS_INVALID", "assets.output") }),
    ...(targets === undefined ? {} : { targets }),
    ...(models === undefined ? {} : { models }),
    ...(textures === undefined ? {} : { textures }),
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
          "bootSplash",
          "window",
          "nativeEntry",
          "renderer",
          "ui",
          "assets",
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
      const bootSplash = await validateBootSplash(raw?.bootSplash, root);
      const assets = raw?.assets === undefined ? undefined : validateAssets(raw.assets);
      return {
        app,
        display: validateDisplay(raw?.display),
        window: validateWindow(raw?.window, app.name),
        nativeEntry: validateNativeEntry(configuredEntry ?? packageEntry ?? "src/game.ts", root),
        renderer: validateRenderer(raw?.renderer),
        ui: validateUi(raw?.ui),
        ...(bootSplash === undefined ? {} : { bootSplash }),
        ...(assets === undefined ? {} : { assets }),
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
