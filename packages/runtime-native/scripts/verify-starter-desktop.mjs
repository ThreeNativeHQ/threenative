#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const READY_MARKER = 'TN_NATIVE_SMOKE_READY:webgpu';
const ASSET_MARKER = 'TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb';
// Measured: a drawn starter frame has ~17,000 distinct colours, a lost capture had 5.
const UNRENDERED_FRAME_COLOR_FLOOR = 64;
// 64x64. Below this the frame is a fixture, not a capture.
const UNRENDERED_FRAME_MIN_PIXELS = 4096;
const ASSET_PIXEL_FLOOR = 100;
// The packaged proof is a cyan/magenta checkerboard pennant, and it is identified by CHANNEL
// MARGIN rather than by distance to the authored texture colour. The gate reads a lit, tonemapped
// render, and the authored cyan never reaches the screen: measured on the CI capture of run
// 34076016432, the pennant's cyan renders as rgb(86,180,189) — 103 away from the authored
// [18,220,255] — while the ocean behind it sits at 149 and the sky at 140. Any absolute-distance
// threshold wide enough to admit the asset also admits the sea, which is how a frame showing the
// pennant plainly was rejected with 798,464 of 921,600 pixels classified as proof.
//
// Magenta is the discriminator, because an ocean world contains none: 521 magenta pixels on the
// pennant, against 0 in the same frame with the pennant cropped away.
const PROOF_MAGENTA_MIN_MARGIN = 40;
// Corroborating cyan, counted only inside the magenta bounds so the background cannot supply it.
const PROOF_CYAN_MIN_MARGIN = 70;
const PROOF_CYAN_IN_BOUNDS_FLOOR = 50;
// A proof region may occupy up to a quarter of a rendered frame; a wash that reaches almost every
// part of the frame must not count as localized evidence.
const MAX_ASSET_BOUNDS_FRACTION = 0.25;
// Bounds alone cannot separate a small asset from magenta scattered thinly across the frame, since
// scattered pixels share almost the same bounding box as a solid one. Density does: the pennant
// fills 0.236 of its own bounds, scattered noise fills 0.04.
const MIN_ASSET_BOUNDS_DENSITY = 0.1;

function isProofMagenta(data, offset) {
  return (
    data[offset + 3] > 0 &&
    data[offset] > data[offset + 1] + PROOF_MAGENTA_MIN_MARGIN &&
    data[offset + 2] > data[offset + 1] + PROOF_MAGENTA_MIN_MARGIN
  );
}

function isProofCyan(data, offset) {
  return (
    data[offset + 3] > 0 &&
    data[offset + 1] - data[offset] > PROOF_CYAN_MIN_MARGIN &&
    data[offset + 2] - data[offset] > PROOF_CYAN_MIN_MARGIN
  );
}

function countProofCyanInBounds(png, bounds) {
  let cyan = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (isProofCyan(png.data, (y * png.width + x) * 4)) cyan += 1;
    }
  }
  return cyan;
}

// Localization is a question about a capture, not about a texture, so only a capture-sized frame
// reaches this. The distribution test feeds the packaged 16x16 proof itself, where the asset
// legitimately fills the whole frame and asking where it sits has no meaning.
function assertProofIsLocalized(png, bounds, magentaAssetPixels) {
  const boundsArea = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
  const boundsFraction = boundsArea / (png.width * png.height);
  if (boundsFraction > MAX_ASSET_BOUNDS_FRACTION) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_LOCALIZED: magenta spans ${(boundsFraction * 100).toFixed(1)}% of the frame, which is a wash, not the proof asset.`,
    );
  }
  const density = magentaAssetPixels / boundsArea;
  if (density < MIN_ASSET_BOUNDS_DENSITY) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_LOCALIZED: magenta fills only ${(density * 100).toFixed(1)}% of its own bounds, which is scatter, not the proof asset.`,
    );
  }
}

// One pass over the frame: the colour census the unrendered-frame floor reads, and the magenta
// pixel count with the bounds it occupies.
function scanProofMagenta(png) {
  const colors = new Set();
  const bounds = { maxX: -1, maxY: -1, minX: png.width, minY: png.height };
  let magentaAssetPixels = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    colors.add(
      `${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}`,
    );
    if (!isProofMagenta(png.data, index)) continue;
    magentaAssetPixels += 1;
    const pixel = index / 4;
    const x = pixel % png.width;
    const y = Math.floor(pixel / png.width);
    if (x < bounds.minX) bounds.minX = x;
    if (x > bounds.maxX) bounds.maxX = x;
    if (y < bounds.minY) bounds.minY = y;
    if (y > bounds.maxY) bounds.maxY = y;
  }
  return { bounds, colors, magentaAssetPixels };
}

export function inspectStarterScreenshot(path) {
  if (!existsSync(path)) throw new Error(`TN_NATIVE_STARTER_SCREENSHOT_MISSING: ${path}`);
  const png = PNG.sync.read(readFileSync(path));
  const { bounds, colors, magentaAssetPixels } = scanProofMagenta(png);
  if (colors.size < 2) throw new Error('TN_NATIVE_STARTER_SCREENSHOT_BLANK: one-color frame.');
  // A one-colour guard is too weak to catch the capture this gate actually loses. A rendered
  // starter frame carries roughly 17k distinct colours; an intermittent CI failure captured five —
  // flat background, two flat shapes, thirteen pixels of the GLB — while the run log still showed
  // TN_NATIVE_STARTER_ASSETS_LOADED and "Rendered 300 frames". That frame was never drawn, and
  // reporting it as a missing asset sends the reader hunting for a texture that loaded fine.
  // Only meaningful at capture resolution. A 16x16 synthetic fixture — what the installed-verifier
  // distribution test feeds this function — is legitimately two colours, and judging it by the
  // diversity a 1280x720 render carries would reject a frame that is exactly what it claims to be.
  const rendered = png.width * png.height >= UNRENDERED_FRAME_MIN_PIXELS;
  if (rendered && colors.size < UNRENDERED_FRAME_COLOR_FLOOR) {
    throw new Error(
      `TN_NATIVE_STARTER_FRAME_NOT_RENDERED: only ${colors.size} distinct colours in ${png.width}x${png.height}. The run log may still show every marker: this is the capture, not the scene.`,
    );
  }
  if (magentaAssetPixels < ASSET_PIXEL_FLOOR) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: found ${magentaAssetPixels} magenta proof pixels in a frame of ${colors.size} colours.`,
    );
  }
  if (rendered) assertProofIsLocalized(png, bounds, magentaAssetPixels);
  const cyanAssetPixels = countProofCyanInBounds(png, bounds);
  if (cyanAssetPixels < PROOF_CYAN_IN_BOUNDS_FLOOR) {
    throw new Error(
      `TN_NATIVE_STARTER_ASSET_NOT_VISIBLE: magenta found but only ${cyanAssetPixels} cyan proof pixels inside its bounds; the checkerboard needs both colours.`,
    );
  }
  return {
    colors: colors.size,
    cyanAssetPixels,
    height: png.height,
    magentaAssetPixels,
    width: png.width,
  };
}

export function analyzeStarterLog(log, frames = 300) {
  const failures = [];
  for (const marker of [READY_MARKER, ASSET_MARKER, `TN_NATIVE_SMOKE_${frames}_FRAMES:${frames}`]) {
    if (!log.includes(marker)) failures.push(`missing ${marker}`);
  }
  if (!new RegExp(`Rendered ${frames} frames in \\d+ms`, 'u').test(log)) {
    failures.push(`missing exact ${frames}-frame completion`);
  }
  for (const pattern of [/TN_NATIVE_START_FAILED/u, /validation error/iu, /TypeError:/u]) {
    if (pattern.test(log)) failures.push(`runtime log matched ${pattern}`);
  }
  // The capture is only evidence if the world was on screen when it was taken. The host holds the
  // screenshot until the startup gate opens and says so; a 0 here means it captured the loading
  // state after waiting out its budget, which is the difference between a 17,000-colour frame and
  // a five-colour one.
  if (log.includes('TN_STARTUP_CAPTURE_READY:0')) {
    failures.push('startup gate never opened before capture (TN_STARTUP_CAPTURE_READY:0)');
  }
  return failures;
}

const CONTAINER_MANIFEST = 'threenative-container.json';
// The scaffold copies this PNG to a starter's `public/icon.png` as the engine's own art. A
// distributed game whose embedded icon is still these bytes never replaced it.
const ENGINE_DEFAULT_ICON = new URL(
  '../../create-threenative/template-assets/icon.png',
  import.meta.url,
);

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function containerManifestPath(root) {
  for (const relative of [join('Contents', 'Resources', CONTAINER_MANIFEST), CONTAINER_MANIFEST]) {
    if (existsSync(join(root, relative))) return join(root, relative);
  }
  return undefined;
}

/** First `.desktop` entry named by the container's resource inventory, so the id stays authored. */
function desktopEntryPath(manifest) {
  const resources = manifest.resources;
  if (!resources || typeof resources !== 'object') return undefined;
  return Object.keys(resources).find(
    (relative) => relative.endsWith('.desktop') && relative.includes('applications/'),
  );
}

function desktopEntryValues(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Za-z][A-Za-z0-9-]*)=(.*)$/u.exec(line.trim());
    if (match && values[match[1]] === undefined) values[match[1]] = match[2];
  }
  return values;
}

function plistString(plist, key) {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'u').exec(plist);
  return match?.[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

function inspectContainerIcon(containerRoot, manifest, config, options) {
  const configured = config.app?.icon;
  if (configured === undefined) return undefined;
  const configuredPath = resolve(configured);
  if (!existsSync(configuredPath)) {
    throw new Error(
      `TN_NATIVE_STARTER_BRAND_CONFIG_ICON_MISSING: app.icon does not exist: ${configuredPath}`,
    );
  }
  const declared = manifest.app?.icon;
  if (typeof declared !== 'string' || declared.length === 0) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_MISSING: the container manifest names no embedded application icon.',
    );
  }
  const iconPath = join(containerRoot, declared);
  if (!existsSync(iconPath) || !statSync(iconPath).isFile()) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_ICON_MISSING: ${declared} is named by the container but absent from the payload.`,
    );
  }
  const embedded = sha256File(iconPath);
  const engineIcon = options.engineIcon
    ?? (existsSync(ENGINE_DEFAULT_ICON) ? fileURLToPath(ENGINE_DEFAULT_ICON) : undefined);
  if (engineIcon !== undefined && embedded === sha256File(engineIcon)) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT: the embedded application icon is the engine default, not the game-authored icon.',
    );
  }
  if (typeof manifest.app.iconSha256 === 'string' && manifest.app.iconSha256 !== embedded) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_TAMPERED: ${declared} does not match the container's recorded icon hash.`,
    );
  }
  if (embedded !== sha256File(configuredPath)) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH: the embedded icon ${declared} is not the icon app.icon declares.`,
    );
  }
  return { path: declared, sha256: embedded };
}

function linuxLauncherName(containerRoot, manifest) {
  const relative = desktopEntryPath(manifest);
  if (relative === undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING: the Linux container declares no .desktop application metadata.',
    );
  }
  const path = join(containerRoot, relative);
  if (!existsSync(path)) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING: ${relative} is named but absent from the payload.`,
    );
  }
  const entry = desktopEntryValues(readFileSync(path, 'utf8'));
  if (entry.Name === undefined) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING: ${relative} has no Name= entry for the file manager.`,
    );
  }
  return { name: entry.Name, source: relative };
}

function darwinLauncherName(containerRoot) {
  const relative = join('Contents', 'Info.plist');
  const path = join(containerRoot, relative);
  if (!existsSync(path)) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING: the macOS bundle has no ${relative}.`,
    );
  }
  const name =
    plistString(readFileSync(path, 'utf8'), 'CFBundleName') ??
    plistString(readFileSync(path, 'utf8'), 'CFBundleDisplayName');
  if (name === undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING: Info.plist has no CFBundleName or CFBundleDisplayName.',
    );
  }
  return { name, source: relative };
}

function inspectContainerName(containerRoot, manifest, config, platform) {
  const expected = config.app?.name;
  if (expected === undefined) return undefined;
  // Windows identity lives in the executable's PE resource section, which is written and read by
  // OS tooling, not this inspector; the manifest records the identity the writer embedded.
  const found = platform === 'linux'
    ? linuxLauncherName(containerRoot, manifest)
    : platform === 'darwin'
      ? darwinLauncherName(containerRoot)
      : { name: manifest.app?.name, source: CONTAINER_MANIFEST };
  if (found.name !== expected) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH: the ${platform} launcher names '${found.name}', config says '${expected}'.`,
    );
  }
  return found;
}

function assertDeclaredLoading(declared, config) {
  const expected = config.bootSplash ?? null;
  const actual = declared.bootSplash ?? null;
  if (expected === null || actual === null) {
    if (expected !== actual) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: the container does not declare the boot/loading sequence the config requires.',
      );
    }
    return { bootSplash: actual, source: CONTAINER_MANIFEST };
  }
  const expectedImage = expected.image === undefined ? null : sha256File(resolve(expected.image));
  if (
    actual.backgroundColor !== expected.backgroundColor ||
    (actual.imageSha256 ?? null) !== expectedImage
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH: the container boot/loading sequence differs from the consumer config.',
    );
  }
  return { bootSplash: actual, source: CONTAINER_MANIFEST };
}

function inspectContainerLoading(containerRoot, manifest, config) {
  if (manifest.loading !== undefined) return assertDeclaredLoading(manifest.loading, config);
  // PRD-365 containers already declare their launch surface, which is what the game's loading
  // handoff renders through. Fall back to it until the container records a boot/loading block.
  if (config.ui === undefined && config.bootSplash === undefined) return undefined;
  const renderer = config.ui?.renderer ?? 'native';
  if (renderer === 'web') {
    const entry = manifest.ui?.entry;
    if (typeof entry !== 'string' || !existsSync(join(containerRoot, entry))) {
      throw new Error(
        'TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: the container declares no UI launch entry for the web loading handoff.',
      );
    }
    return { uiEntry: entry, source: CONTAINER_MANIFEST };
  }
  if (manifest.ui !== null && manifest.ui !== undefined) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH: the config uses the native loading path but the container ships a UI launch surface.',
    );
  }
  return { uiEntry: null, source: CONTAINER_MANIFEST };
}

function readContainerManifest(containerRoot) {
  const manifestPath = containerManifestPath(containerRoot);
  if (manifestPath === undefined) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MISSING: no ${CONTAINER_MANIFEST} under ${containerRoot}.`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !manifest.app ||
    typeof manifest.app !== 'object'
  ) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID: the manifest carries no application identity.',
    );
  }
  return manifest;
}

/**
 * Inspect a distributed desktop container's brand against the consumer config that declared it.
 *
 * `root` is the directory PRD-365 packages (the single top-level folder an archive extracts to).
 * Three independent surfaces are compared and each failure names the actual cause: the embedded
 * application icon, the launcher/file-manager application name, and the declared loading/launch
 * sequence. It never launches the app and never inspects the runtime SDL window, so it makes no
 * claim about pixels a player sees.
 */
export function inspectContainerBrand(root, config, options = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('TN_NATIVE_STARTER_BRAND_CONFIG_INVALID: consumer config must be an object.');
  }
  const containerRoot = resolve(root);
  if (!existsSync(containerRoot) || !statSync(containerRoot).isDirectory()) {
    throw new Error(`TN_NATIVE_STARTER_CONTAINER_MISSING: ${containerRoot} is not a directory.`);
  }
  const manifest = readContainerManifest(containerRoot);
  const platform = String(manifest.platform ?? process.platform).split('-')[0];
  const evidence = {
    icon: inspectContainerIcon(containerRoot, manifest, config, options),
    name: inspectContainerName(containerRoot, manifest, config, platform),
    loading: inspectContainerLoading(containerRoot, manifest, config),
  };
  if (Object.values(evidence).every((value) => value === undefined)) {
    throw new Error(
      'TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED: the container and config declare no brand to inspect.',
    );
  }
  return evidence;
}

export function verifyStarterDesktop({ frames = 300, project = process.cwd() } = {}) {
  const projectRoot = resolve(project);
  const manifest = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const projectName = basename(String(manifest.name ?? 'starter').replace(/^@[^/]+\//u, ''));
  const executableName = process.platform === 'win32' ? `${projectName}.exe` : projectName;
  const artifact = join(projectRoot, 'dist-native', executableName);
  if (!existsSync(artifact)) {
    throw new Error(`TN_NATIVE_STARTER_ARTIFACT_MISSING: run pnpm build:desktop first (${artifact}).`);
  }
  const artifactDirectory = join(projectRoot, 'artifacts', 'native');
  const screenshot = join(artifactDirectory, 'starter-desktop.png');
  const logPath = join(artifactDirectory, 'starter-desktop.log');
  const reportPath = join(artifactDirectory, 'starter-desktop-report.json');
  mkdirSync(artifactDirectory, { recursive: true });
  // Windowed at the configured size, not the starter's `display.fullscreen: true` default: a
  // headless Windows runner has no interactive desktop for a fullscreen swap and the process was
  // seen to hang in it, and a fixed window keeps the capture size the render gates already assert.
  const runtimeArgs = ['--windowed', '--screenshot', screenshot, '--frames', String(frames)];
  // See verify-desktop-core.mjs: `xvfb-run` hands back its own failing cleanup kill's status.
  const displayHelper = join(dirname(fileURLToPath(import.meta.url)), 'xvfb.sh');
  if (process.platform === 'linux' && !existsSync(displayHelper)) {
    throw new Error(`TN_NATIVE_STARTER_DISPLAY_SUPPORT_MISSING: ${displayHelper}`);
  }
  const command = process.platform === 'linux' ? 'sh' : artifact;
  const args = process.platform === 'linux'
    ? [displayHelper, artifact, ...runtimeArgs]
    : runtimeArgs;
  // A hosted Windows runner renders 300 frames on a software adapter with the WebView2 overlay
  // compositing alongside, which is slower than the Linux and macOS lanes; the override keeps a
  // genuinely hung run bounded at the caller's number instead of ours.
  const timeoutMs = Number(process.env.TN_STARTER_TIMEOUT_MS ?? 300_000);
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: process.platform === 'linux' ? { ...process.env, SDL_VIDEODRIVER: 'x11' } : process.env,
    timeout: timeoutMs,
  });
  // Write the captured output before judging it. On a timeout `spawnSync` sets `error` and the old
  // code threw before the log existed, so a Windows run that hung reported only ETIMEDOUT and no
  // clue where it stopped; the log is the diagnosis.
  const log = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync(logPath, log);
  if (result.error) {
    throw new Error(`TN_NATIVE_STARTER_SPAWN_FAILED: ${result.error.message}\n${log}`);
  }
  if (result.status !== 0) throw new Error(`TN_NATIVE_STARTER_EXIT_${result.status}:\n${log}`);
  const failures = analyzeStarterLog(log, frames);
  if (failures.length > 0) throw new Error(`TN_NATIVE_STARTER_LOG_FAILED:\n${failures.join('\n')}`);
  // Windows (DWM) and macOS (Quartz) always composite, so the default starter's WebView HUD must
  // attach there. Linux CI runs a bare Xvfb with no compositor and the overlay correctly refuses,
  // so this is asserted only where the desktop compositor is part of the OS.
  const overlayAttached = log.includes('"attached":true');
  if ((process.platform === 'win32' || process.platform === 'darwin') && !overlayAttached) {
    throw new Error(
      'TN_NATIVE_STARTER_UI_OVERLAY_MISSING: the starter WebView HUD did not attach on this always-composited desktop host.',
    );
  }
  const image = inspectStarterScreenshot(screenshot);
  const report = {
    artifact,
    completedAt: new Date().toISOString(),
    frames,
    image,
    log: logPath,
    overlayAttached,
    pass: true,
    screenshot,
    screenshotSha256: createHash('sha256').update(readFileSync(screenshot)).digest('hex'),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    const report = verifyStarterDesktop();
    console.log(`starter desktop gate passed: ${report.frames} frames, ${report.image.colors} colors, ${report.image.cyanAssetPixels} asset pixels`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
