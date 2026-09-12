#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertNativeAssetsDecodable, deriveDesktopWebpSupport } from './asset-preflight.mjs';
import { installPrebuilt } from './install-prebuilt.mjs';

// The container helper is imported lazily by the release path only. A published install ships the
// scripts listed in package.json `files`; the helper joins that list in PRD-365 phase 2, so until
// then a consumer that never asks for a release container must not fail on an unresolved import.
const loadDistribution = () => import('./desktop-distribution.mjs');

const runtimeRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Resolve the desktop runtime binary a consumer build compiles against.
 *
 * A published install ships no compiled runtime until the postinstall hook fetches one, so a
 * missing `--runtime` installs from the release manifest rather than failing with a bare
 * "missing file". `THREENATIVE_RUNTIME_SOURCE` remains the decoder-preflight source only: it
 * never selects or substitutes the runtime binary, and no code path here reads a checkout as
 * the runtime. `options.runtimeSource` is an explicit test seam for the preflight directory.
 */
export async function resolveDesktopRuntime(explicit, options = {}) {
  if (explicit) {
    if (!existsSync(explicit)) throw new Error(`Missing prebuilt runtime for '${process.platform}-${process.arch}': ${explicit}`);
    return explicit;
  }
  const sourceOverride = options.runtimeSource ?? process.env.THREENATIVE_RUNTIME_SOURCE;
  if (sourceOverride) {
    throw new Error(
      `Desktop source-checkout preflight is set (THREENATIVE_RUNTIME_SOURCE=${sourceOverride}) but no --runtime was provided. ` +
        'Pass the checkout-built --runtime explicitly for a maintainer build; consumer builds unset the override and install from the release manifest.',
    );
  }
  return installPrebuilt({ ...options.install, reuse: true });
}

export const DEFAULT_DESKTOP_CONFIG = {
  app: { id: 'com.threenative.game', name: 'ThreeNative', version: '0.1.0', build: 1 },
  display: { orientation: 'landscape', fullscreen: true, keepScreenOn: false, maxFps: 60 },
  window: { title: 'ThreeNative', width: 1280, height: 720, maximized: false, resizable: true },
};

function readConfig(configPath) {
  if (configPath === undefined) return DEFAULT_DESKTOP_CONFIG;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`TN_CONFIG_FILE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--assets', '--bundle', '--config', '--mode', '--output', '--runtime', '--ui'].includes(flag) || !value) {
      throw new Error('Usage: package-desktop.mjs --bundle FILE --output FILE [--runtime FILE] [--assets DIR] [--ui DIR] [--config FILE] [--mode debug|release]');
    }
    // `--mode` is a word, not a path; every other flag names a filesystem location.
    options[flag.slice(2)] = flag === '--mode' ? value : resolve(value);
  }
  if (options.mode !== undefined && options.mode !== 'debug' && options.mode !== 'release') {
    throw new Error(`Unknown build mode '${options.mode}'. Choose debug or release.`);
  }
  // `--runtime` is optional: a consumer build with no `--runtime` installs the verified
  // prebuilt from the release manifest via resolveDesktopRuntime. A maintainer build passes
  // the checkout-built binary explicitly.
  for (const required of ['bundle', 'output']) {
    if (!options[required]) throw new Error(`Missing --${required}.`);
  }
  return options;
}

export function packageDesktop(options) {
  const key = `${process.platform}-${process.arch}`;
  if (!['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'].includes(key)) {
    throw new Error(`Unsupported desktop platform '${key}'.`);
  }
  if (!options.bundle || !existsSync(options.bundle)) {
    throw new Error(`Missing native bundle for '${key}': ${options.bundle ?? '(not provided)'}`);
  }
  // An explicit `--runtime` keeps the original sync body: the preflight failure the
  // decoder tests assert stays a sync throw. Only the missing-runtime install is async.
  if (options.runtime) {
    if (!existsSync(options.runtime)) {
      throw new Error(`Missing prebuilt runtime for '${key}': ${options.runtime}`);
    }
    return compileOrPackage(options, options.runtime);
  }
  return resolveDesktopRuntime(undefined, { runtimeSource: options.runtimeSource, install: options.install }).then((runtime) =>
    compileOrPackage(options, runtime),
  );
}

function compileOrPackage(options, runtime) {
  if (options.mode === 'release') return packageDesktopRelease(options, runtime);
  return compileDesktopArtifact(options, runtime);
}

/**
 * Wrap the compiled executable in the complete desktop container for the host OS (PRD-365).
 *
 * The runtime compiler only knows how to produce a raw executable and stage `ui/` beside it; the
 * container layout, OS metadata and dependency census are OS operations and live in
 * `desktop-distribution.mjs`. The raw debug path above is untouched.
 */
async function packageDesktopRelease(options, runtime) {
  const { classifyDependencies, containerSlug, discoverRuntimeDependencies, packageDesktopContainer } =
    await loadDistribution();
  const staging = mkdtempSync(join(tmpdir(), 'threenative-desktop-release-'));
  try {
    const config = options.config === undefined ? DEFAULT_DESKTOP_CONFIG : readConfig(options.config);
    const rawOutput = join(staging, containerSlug(basename(options.output)));
    const executable = compileDesktopArtifact({ ...options, output: rawOutput }, runtime);
    const uiRenderer = config.ui?.renderer === 'web' ? 'web' : 'native';
    const uiDirectory = uiRenderer === 'web' ? join(dirname(executable), 'ui') : undefined;
    const discovered = options.dependencies === undefined
      ? classifyDependencies(discoverRuntimeDependencies(executable, { platform: process.platform, run: options.run }), {
          platform: process.platform,
        })
      : { bundled: options.dependencies, prerequisites: options.prerequisites ?? [] };
    const icon = config.app?.icon === undefined ? undefined : resolve(config.app.icon);
    const result = packageDesktopContainer({
      arch: process.arch,
      config,
      dependencies: discovered.bundled,
      executable,
      icon,
      output: options.output,
      platform: process.platform,
      prerequisites: discovered.prerequisites,
      run: options.run,
      uiDirectory,
      uiRenderer,
    });
    console.log(`ThreeNative desktop container: ${result.archive}`);
    return result.archive;
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

function compileDesktopArtifact(options, runtime) {
  const output = process.platform === 'win32' && !options.output.endsWith('.exe')
    ? `${options.output}.exe`
    : options.output;
  mkdirSync(dirname(output), { recursive: true });
  const staging = mkdtempSync(join(tmpdir(), 'threenative-desktop-'));
  try {
    const stagedEntry = stageDesktopFiles(
      options.bundle,
      options.assets,
      staging,
      options.config === undefined ? undefined : readConfig(options.config),
      process.env.THREENATIVE_RUNTIME_SOURCE ?? runtimeRoot,
    );
    // The UI bundle sits beside the executable rather than inside it. Desktop compiles to one
    // file, but the overlay's web view reads its page from a real path — that is what gives it a
    // real origin, the way `WebViewAssetLoader` does on Android, and it is the difference between
    // `fetch` behaving as it does on web and not. A game with the native UI renderer ships neither
    // the directory nor an overlay.
    stageDesktopUi(
      options.ui,
      options.config === undefined ? 'native' : readConfig(options.config).ui?.renderer ?? 'native',
      join(dirname(output), 'ui'),
    );
    const args = [
      'compile',
      stagedEntry,
      '--root',
      staging,
      '--include',
      staging,
      '--out',
      output,
    ];
    const result = spawnSync(runtime, args, { encoding: 'utf8', stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Runtime packager exited with code ${result.status ?? 'unknown'}.`);
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
  if (process.platform !== 'win32') chmodSync(output, 0o755);
  console.log(`ThreeNative desktop artifact: ${output}`);
  return output;
}

/**
 * Stage the built UI bundle beside the desktop executable.
 *
 * Fails closed both ways, for the same reasons the Android packager does: a `web` game with no
 * built UI would install, launch and show nothing over a working game, and a `native` game must
 * ship no bundle at all.
 */
export function stageDesktopUi(ui, renderer, destination) {
  rmSync(destination, { force: true, recursive: true });
  if (renderer !== 'web') {
    if (ui) {
      throw new Error(
        `TN_UI_BUNDLE_UNEXPECTED: a UI bundle was staged for a game whose ui.renderer is '${renderer}'. ` +
          'The native renderer ships no web view; remove the bundle or set ui.renderer to "web".',
      );
    }
    return [];
  }
  if (!ui || !existsSync(ui)) {
    throw new Error(
      `TN_UI_BUNDLE_MISSING: ui.renderer is "web" but no built UI was found at ${ui ?? '(not provided)'}. ` +
        'Build the UI before packaging, or set ui.renderer to "native".',
    );
  }
  if (!statSync(ui).isDirectory()) throw new Error(`TN_UI_BUNDLE_MISSING: not a directory: ${ui}`);
  if (!existsSync(join(ui, 'index.html'))) {
    throw new Error(
      `TN_UI_BUNDLE_MISSING: ${ui} has no index.html, which is the page the overlay loads.`,
    );
  }
  mkdirSync(destination, { recursive: true });
  cpSync(ui, destination, { recursive: true });
  return readdirSync(destination);
}

export function stageDesktopFiles(
  bundle,
  assets,
  staging,
  config = undefined,
  runtimeSource = runtimeRoot,
) {
  mkdirSync(staging, { recursive: true });
  if (assets && existsSync(assets)) {
    if (!statSync(assets).isDirectory()) {
      throw new Error(`Desktop assets path is not a directory: ${assets}`);
    }
    // Desktop ran no preflight at all, so an asset the runtime cannot decode reached the same
    // rejected `decodeAudioData` that black-screened an APK — with the packager having already
    // read the bytes on its way past. Same gate, desktop's own derived capabilities.
    assertNativeAssetsDecodable(assets, {
      target: 'desktop',
      capabilities: { webp: deriveDesktopWebpSupport(runtimeSource) },
    });
    for (const entry of readdirSync(assets)) {
      if (entry === '.threenative') {
        throw new Error('TN_NATIVE_ASSET_RESERVED_PATH: public/.threenative is reserved.');
      }
      cpSync(join(assets, entry), join(staging, entry), { recursive: true });
    }
  }
  const entry = join(staging, '.threenative', 'game.js');
  mkdirSync(dirname(entry), { recursive: true });
  copyFileSync(bundle, entry);
  if (config !== undefined) {
    const icon = config.app?.icon ?? config.app?.icons?.android?.foreground;
    const packaged = { ...config, app: { ...(config.app ?? {}) } };
    // Flattened deliberately. The embedded config is read by a small scanner in the C++ host, and
    // `renderer` already exists at the top level as the WebGPU preference — a nested lookup for a
    // second `renderer` would find the wrong one. Anything but "web" is the native renderer.
    packaged.uiRenderer = config.ui?.renderer === 'web' ? 'web' : 'native';
    packaged.maxFps = config.display?.maxFps ?? 60;
    if (icon !== undefined) {
      if (!existsSync(icon) || !statSync(icon).isFile()) {
        throw new Error(`TN_CONFIG_BRAND_DESKTOP_MISSING: app icon does not exist: ${icon}`);
      }
      const stagedIcon = join(staging, '.threenative', 'app-icon.png');
      copyFileSync(icon, stagedIcon);
      packaged.app.icon = '.threenative/app-icon.png';
    }
    writeFileSync(join(staging, '.threenative', 'config.json'), `${JSON.stringify(packaged, null, 2)}\n`);
  }
  return entry;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await packageDesktop(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
