#!/usr/bin/env node

/**
 * OS container and resource operations for desktop release artifacts.
 *
 * `packageDesktop` delegates here for `--mode release`; the raw-binary debug path stays exactly
 * as it was. Nothing in this file decides how a game looks — it wraps the produced executable,
 * its UI bundle and the runtime dependencies discovered from that executable into one relocatable
 * container per native host, and writes the OS metadata that names the game.
 *
 * Signing and notarization are deliberately absent: they arrive in PRD-365 phase 3 and are
 * separate from an unsigned, complete container.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
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
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const CONTAINER_MANIFEST = 'threenative-container.json';
export const CONTAINER_SCHEMA_VERSION = 1;
export const DESKTOP_TARGETS = ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64'];

// The loader's own directories. A library resolved from one of these is the player's machine to
// provide; everything else the runtime actually needs travels inside the container, or the
// artifact is not relocatable. Matched against the resolved path, because a bundled library can
// carry any soname.
const SYSTEM_LIBRARY_DIRECTORIES = [
  '/lib/',
  '/lib64/',
  '/usr/lib/',
  '/usr/lib64/',
  '/usr/libexec/',
  '/usr/lib/system/',
  '/System/Library/',
  '/usr/local/lib/system/',
];

// Libraries the platform itself owns, by name, whether or not the tool resolved a path. The GTK,
// WebKit, X11 and Wayland stacks are the documented Linux player prerequisite (PRD-365 phase 2),
// not something an unsigned tarball re-ships.
const SYSTEM_LIBRARY_NAMES = new Set([
  'libc.so.6', 'libm.so.6', 'libdl.so.2', 'libpthread.so.0', 'librt.so.1', 'libgcc_s.so.1',
  'libstdc++.so.6', 'libatomic.so.1', 'libnsl.so.1', 'libutil.so.1', 'libresolv.so.2',
  'libX11.so.6', 'libXext.so.6', 'libXrandr.so.2', 'libXi.so.6', 'libXcursor.so.1',
  'libXinerama.so.1', 'libxkbcommon.so.0', 'libwayland-client.so.0', 'libwayland-server.so.0',
  'libwayland-cursor.so.0', 'libwayland-egl.so.1', 'libepoxy.so.0', 'libgbm.so.1', 'libdrm.so.2',
  'libGL.so.1', 'libEGL.so.1', 'libGLESv2.so.2', 'libvulkan.so.1', 'libasound.so.2',
  'libpulse.so.0', 'libdbus-1.so.3', 'libudev.so.1', 'libsystemd.so.0',
  'libgobject-2.0.so.0', 'libglib-2.0.so.0', 'libgio-2.0.so.0', 'libgtk-3.so.0',
  'libgdk-3.so.0', 'libwebkit2gtk-4.1.so.0', 'libjavascriptcoregtk-4.1.so.0', 'libsoup-3.0.so.0',
  'libz.so.1', 'libexpat.so.1', 'libfontconfig.so.1', 'libfreetype.so.6', 'libpng16.so.16',
  'libharfbuzz.so.0', 'libpango-1.0.so.0', 'libcairo.so.2', 'libcairo-gobject.so.2',
  'libgdk_pixbuf-2.0.so.0', 'libatk-1.0.so.0', 'libatk-bridge-2.0.so.0', 'libcurl.so.4',
]);

const SYSTEM_WINDOWS_DLLS = new Set([
  'kernel32.dll', 'user32.dll', 'gdi32.dll', 'advapi32.dll', 'shell32.dll', 'ole32.dll',
  'oleaut32.dll', 'ws2_32.dll', 'opengl32.dll', 'winmm.dll', 'userenv.dll', 'version.dll',
  'setupapi.dll', 'cfgmgr32.dll', 'bcrypt.dll', 'crypt32.dll', 'dwmapi.dll', 'shlwapi.dll',
  'comdlg32.dll', 'imm32.dll', 'uxtheme.dll', 'd3d11.dll', 'dxgi.dll', 'd3dcompiler_47.dll',
]);

function exec(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  return {
    error: result.error,
    signal: result.signal,
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  };
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function missing(path, label) {
  return `TN_DESKTOP_INPUT_MISSING: ${label} does not exist: ${path}`;
}

function assertDirectory(path, label) {
  if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(missing(path ?? '(not provided)', label));
  }
}

function assertFile(path, label) {
  if (!path || !existsSync(path) || !statSync(path).isFile()) {
    throw new Error(missing(path ?? '(not provided)', label));
  }
}

export function desktopTargetKey(platform = process.platform, arch = process.arch) {
  const key = `${platform}-${arch}`;
  if (!DESKTOP_TARGETS.includes(key)) {
    throw new Error(`Unsupported desktop platform '${key}'.`);
  }
  return key;
}

export function desktopContainerFormat(platform = process.platform) {
  if (platform === 'linux') return 'tar.gz';
  if (platform === 'darwin' || platform === 'win32') return 'zip';
  throw new Error(`TN_DESKTOP_CONTAINER_UNSUPPORTED: no container format for '${platform}'.`);
}

export function containerArchivePath(output, platform = process.platform) {
  const extension = desktopContainerFormat(platform) === 'tar.gz' ? '.tar.gz' : '.zip';
  return output.endsWith(extension) ? output : `${output}${extension}`;
}

/** A filesystem-safe project name; the game's display name stays in the OS metadata. */
export function containerSlug(appName) {
  return String(appName).trim().replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'game';
}

/** The single top-level directory an archive extracts to, so a container is one relocatable unit. */
export function containerRootFolder(platform, appName) {
  return platform === 'darwin' ? `${appName}.app` : containerSlug(appName);
}

function listFiles(root) {
  const files = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relativePath);
      else if (entry.isFile()) files.push({ absolute, relative: relativePath });
    }
  };
  walk(root, '');
  return files;
}

/**
 * Parse the dependency tool every native host already ships. Kept pure so the contract can be
 * pinned without a binary that links anything.
 */
export function parseLinkedLibraries(output, platform) {
  const libraries = [];
  if (platform === 'linux') {
    for (const line of output.split('\n')) {
      const resolved = /^\s*(\S+)\s+=>\s+(\S+)\s+\(0x[0-9a-f]+\)\s*$/u.exec(line);
      if (resolved) {
        libraries.push({ name: resolved[1], path: resolved[2] });
        continue;
      }
      // `linux-vdso.so.1` and `/lib64/ld-linux-x86-64.so.2` have no `=>`; they are the kernel and
      // loader and are never bundled. A bare `=> not found` has no path and fails closed later.
      const unresolved = /^\s*(\S+)\s+=>\s+not found\s*$/u.exec(line);
      if (unresolved) libraries.push({ missing: true, name: unresolved[1] });
    }
    return libraries;
  }
  if (platform === 'darwin') {
    for (const line of output.split('\n').slice(1)) {
      const resolved = /^\s*(\S+)\s+\(compatibility version/u.exec(line);
      if (resolved) libraries.push({ name: basename(resolved[1]), path: resolved[1] });
    }
    return libraries;
  }
  if (platform === 'win32') {
    for (const line of output.split('\n')) {
      const resolved = /^\s*(\S+\.dll)\s*$/iu.exec(line);
      if (resolved) libraries.push({ name: resolved[1], path: undefined });
    }
    return libraries;
  }
  throw new Error(`TN_DESKTOP_CONTAINER_UNSUPPORTED: no dependency tool for '${platform}'.`);
}

/** Inspect the produced executable and return every shared library it loads. */
export function discoverRuntimeDependencies(binary, { platform = process.platform, run = exec } = {}) {
  assertFile(binary, 'desktop executable');
  const tool = platform === 'linux'
    ? { args: [binary], command: 'ldd' }
    : platform === 'darwin'
      ? { args: ['-L', binary], command: 'otool' }
      : { args: ['/DEPENDENTS', binary], command: 'dumpbin' };
  const result = run(tool.command, tool.args, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) {
    throw new Error(
      `TN_DESKTOP_DEPENDENCY_TOOL_MISSING: '${tool.command}' is required to resolve native dependencies (${result.error.message}).`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `TN_DESKTOP_DEPENDENCY_RESOLUTION_FAILED: '${tool.command}' exited ${result.status ?? 'unknown'} for ${binary}.\n${result.stderr}`,
    );
  }
  const libraries = parseLinkedLibraries(result.stdout, platform);
  const unresolved = libraries.filter((library) => library.missing);
  if (unresolved.length > 0) {
    throw new Error(
      `TN_DESKTOP_DEPENDENCY_MISSING: ${unresolved.map((library) => library.name).join(', ')} could not be resolved for ${binary}.`,
    );
  }
  return libraries;
}

function isSystemLibrary(library, platform) {
  if (platform === 'win32') return SYSTEM_WINDOWS_DLLS.has(library.name.toLowerCase());
  if (!library.path) return false;
  if (platform === 'darwin') {
    return library.path.startsWith('/usr/lib/') || library.path.startsWith('/System/');
  }
  return SYSTEM_LIBRARY_NAMES.has(library.name) ||
    SYSTEM_LIBRARY_DIRECTORIES.some((directory) => library.path.startsWith(directory));
}

/**
 * Split the executable's libraries into the ones the player machine provides (recorded as
 * prerequisites) and the ones the container must carry. A library that is neither system nor
 * locatable fails closed rather than shipping an artifact that only launches here.
 */
export function classifyDependencies(libraries, { platform = process.platform } = {}) {
  const bundled = [];
  const prerequisites = [];
  for (const library of libraries) {
    if (isSystemLibrary(library, platform)) {
      prerequisites.push({ name: library.name });
      continue;
    }
    if (!library.path) {
      throw new Error(`TN_DESKTOP_DEPENDENCY_UNLOCATABLE: ${library.name} is not a system library and has no path to copy.`);
    }
    assertFile(library.path, `native dependency ${library.name}`);
    bundled.push({ name: basename(library.path), source: library.path });
  }
  return { bundled, prerequisites };
}

export function containerMetadata({ platform = process.platform, config }) {
  const app = config?.app ?? {};
  const id = app.id ?? 'com.threenative.game';
  const name = app.name ?? 'ThreeNative';
  const version = app.version ?? '0.1.0';
  const build = String(app.build ?? 1);
  const slug = containerSlug(name);
  if (platform === 'linux') {
    return {
      [`share/applications/${id}.desktop`]: [
        '[Desktop Entry]',
        'Type=Application',
        `Name=${name}`,
        `Exec=${slug}`,
        `TryExec=${slug}`,
        `Icon=${id}`,
        'Terminal=false',
        'Categories=Game;',
        'StartupNotify=true',
        '',
      ].join('\n'),
    };
  }
  if (platform === 'darwin') {
    return {
      'Contents/Info.plist': [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>CFBundleDevelopmentRegion</key><string>en</string>',
        `  <key>CFBundleExecutable</key><string>${slug}</string>`,
        `  <key>CFBundleIdentifier</key><string>${id}</string>`,
        '  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>',
        `  <key>CFBundleName</key><string>${name}</string>`,
        `  <key>CFBundleDisplayName</key><string>${name}</string>`,
        '  <key>CFBundlePackageType</key><string>APPL</string>',
        `  <key>CFBundleShortVersionString</key><string>${version}</string>`,
        `  <key>CFBundleVersion</key><string>${build}</string>`,
        `  <key>CFBundleIconFile</key><string>${slug}</string>`,
        '  <key>LSMinimumSystemVersion</key><string>11.0</string>',
        '  <key>NSHighResolutionCapable</key><true/>',
        '</dict>',
        '</plist>',
        '',
      ].join('\n'),
    };
  }
  if (platform === 'win32') {
    // Windows identity lives in the executable's PE resource section, written by `rcedit`.
    return {};
  }
  throw new Error(`TN_DESKTOP_CONTAINER_UNSUPPORTED: no metadata for '${platform}'.`);
}

/** Root-relative paths, one per platform, so every consumer resolves from the container root. */
function layout(platform, { appName, executableName, iconName }) {
  const slug = containerSlug(appName);
  if (platform === 'linux') {
    return {
      executable: slug,
      icon: `share/icons/hicolor/256x256/apps/${iconName}.png`,
      manifest: CONTAINER_MANIFEST,
      ui: 'ui',
    };
  }
  if (platform === 'darwin') {
    return {
      executable: `Contents/MacOS/${slug}`,
      icon: `Contents/Resources/${iconName}.icns`,
      manifest: `Contents/Resources/${CONTAINER_MANIFEST}`,
      ui: 'Contents/MacOS/ui',
    };
  }
  return {
    executable: executableName,
    icon: `${iconName}.png`,
    manifest: CONTAINER_MANIFEST,
    ui: 'ui',
  };
}

function dependencyRelativePath(platform, name) {
  if (platform === 'darwin') return `Contents/Frameworks/${name}`;
  if (platform === 'linux') return `lib/${name}`;
  return name;
}

function metadataRelativePath(platform, relativePath) {
  if (platform === 'darwin') return `Contents/Resources/${relativePath}`;
  return relativePath;
}

function buildIcon(icon, destination, { platform, run }) {
  if (platform === 'linux') {
    copyFileSync(icon, destination);
    return;
  }
  if (platform === 'darwin') {
    if (icon.endsWith('.icns')) {
      copyFileSync(icon, destination);
      return;
    }
    // .icns is what Finder and Dock read; it is built with the OS's own tools, never hand-rolled.
    const iconset = mkdtempSync(join(tmpdir(), 'threenative-iconset-'));
    try {
      for (const size of [16, 32, 64, 128, 256, 512]) {
        const sips = run('sips', ['-z', String(size), String(size), icon, '--out', join(iconset, `icon_${size}x${size}.png`)], {});
        if (sips.error) throw new Error(`TN_DESKTOP_RESOURCE_TOOL_MISSING: 'sips' is required to build an .icns (${sips.error.message}).`);
        if (sips.status !== 0) throw new Error(`TN_DESKTOP_RESOURCE_FAILED: sips exited ${sips.status ?? 'unknown'}.`);
      }
      const built = run('iconutil', ['-c', 'icns', iconset, '-o', destination], {});
      if (built.error) throw new Error(`TN_DESKTOP_RESOURCE_TOOL_MISSING: 'iconutil' is required to build an .icns (${built.error.message}).`);
      if (built.status !== 0) throw new Error(`TN_DESKTOP_RESOURCE_FAILED: iconutil exited ${built.status ?? 'unknown'}.`);
    } finally {
      rmSync(iconset, { force: true, recursive: true });
    }
    return;
  }
  throw new Error(`TN_DESKTOP_CONTAINER_UNSUPPORTED: no icon builder for '${platform}'.`);
}

function archiveContainer({ platform, staging, rootFolder, output, run }) {
  const command = platform === 'linux'
    ? { args: ['-czf', output, '-C', staging, rootFolder], name: 'tar' }
    : { args: ['-r', '-q', output, rootFolder], name: 'zip', options: { cwd: staging } };
  const result = run(command.name, command.args, command.options ?? {});
  if (result.error) {
    throw new Error(
      `TN_DESKTOP_ARCHIVE_TOOL_MISSING: '${command.name}' is required to write ${output} (${result.error.message}).`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `TN_DESKTOP_ARCHIVE_FAILED: '${command.name}' exited ${result.status ?? 'unknown'} for ${output}.\n${result.stderr}`,
    );
  }
}

/** Extract a release archive so a verifier can resolve its payload outside the build tree. */
export function extractContainer(archive, destination, { platform = process.platform, run = exec } = {}) {
  assertFile(archive, 'desktop container archive');
  mkdirSync(destination, { recursive: true });
  const command = desktopContainerFormat(platform) === 'tar.gz'
    ? { args: ['-xzf', archive, '-C', destination], name: 'tar' }
    : { args: ['-q', archive, '-d', destination], name: 'unzip' };
  const result = run(command.name, command.args, {});
  if (result.error) {
    throw new Error(
      `TN_DESKTOP_EXTRACT_TOOL_MISSING: '${command.name}' is required to unpack ${archive} (${result.error.message}).`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`TN_DESKTOP_EXTRACT_FAILED: '${command.name}' exited ${result.status ?? 'unknown'} for ${archive}.`);
  }
  return join(destination, locateContainerRoot(destination));
}

/** The single top-level directory an archive extracted to. */
export function locateContainerRoot(extractDirectory) {
  const directories = readdirSync(extractDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (directories.length !== 1) {
    throw new Error(
      `TN_DESKTOP_CONTAINER_LAYOUT_INVALID: expected one top-level directory in ${extractDirectory}, found ${directories.length}.`,
    );
  }
  return directories[0];
}

/**
 * Resolve a container from wherever it was unpacked. Every recorded resource is addressed
 * relative to the container root, so a move is legal; a resource absent or whose bytes changed
 * is a container that must not launch, not a warning.
 */
export function resolveContainer(root, { platform = process.platform } = {}) {
  const resolvedRoot = resolve(root);
  assertDirectory(resolvedRoot, 'desktop container root');
  const candidates = platform === 'darwin'
    ? [join('Contents', 'Resources', CONTAINER_MANIFEST), CONTAINER_MANIFEST]
    : [CONTAINER_MANIFEST, join('Contents', 'Resources', CONTAINER_MANIFEST)];
  const manifestRelative = candidates.find((candidate) => existsSync(join(resolvedRoot, candidate)));
  if (!manifestRelative) {
    throw new Error(`TN_DESKTOP_CONTAINER_MANIFEST_MISSING: no ${CONTAINER_MANIFEST} under ${resolvedRoot}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(resolvedRoot, manifestRelative), 'utf8'));
  } catch (error) {
    throw new Error(`TN_DESKTOP_CONTAINER_MANIFEST_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const [relativePath, expected] of Object.entries(manifest.resources ?? {})) {
    const absolute = resolve(resolvedRoot, relativePath);
    const within = relative(resolvedRoot, absolute);
    if (within.startsWith('..') || isAbsolute(within)) {
      throw new Error(
        `TN_DESKTOP_CONTAINER_MANIFEST_INVALID: ${relativePath} escapes the container root.`,
      );
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(
        `TN_DESKTOP_CONTAINER_INCOMPLETE: ${relativePath} is named by the container manifest but is not in the payload.`,
      );
    }
    const actual = sha256File(absolute);
    if (actual !== expected.sha256) {
      throw new Error(
        `TN_DESKTOP_CONTAINER_TAMPERED: ${relativePath} hashes ${actual}, not the recorded ${expected.sha256}.`,
      );
    }
  }
  return manifest;
}

/** The game identity the container carries must equal the one the author configured. */
export function assertContainerIdentity(manifest, config, { icon } = {}) {
  const app = config?.app ?? {};
  for (const field of ['id', 'name', 'version']) {
    if (manifest.app?.[field] !== app[field]) {
      throw new Error(
        `TN_DESKTOP_BRAND_MISMATCH: container app.${field} is '${manifest.app?.[field]}', config says '${app[field]}'.`,
      );
    }
  }
  if (icon !== undefined) {
    assertFile(icon, 'app icon');
    const expected = sha256File(icon);
    if (manifest.app?.iconSha256 !== expected) {
      throw new Error('TN_DESKTOP_BRAND_MISMATCH: the container did not embed the configured app icon.');
    }
  }
  return manifest;
}

/**
 * Build one complete, unsigned desktop container.
 *
 * The caller supplies the executable the runtime compiler produced, the UI bundle when the game
 * uses the web renderer, and the dependencies discovered from that executable. Everything is
 * addressed relative to a single top-level directory, so the archive can be moved anywhere.
 */
export function packageDesktopContainer({
  platform = process.platform,
  arch = process.arch,
  executable,
  executableName,
  uiDirectory,
  uiRenderer = 'native',
  dependencies = [],
  prerequisites = [],
  config,
  icon,
  output,
  run = exec,
} = {}) {
  const key = desktopTargetKey(platform, arch);
  const format = desktopContainerFormat(platform);
  if (!output) throw new Error('TN_DESKTOP_OUTPUT_MISSING: packageDesktopContainer needs an output path.');
  assertFile(executable, 'desktop executable');
  if (uiRenderer === 'web') {
    assertDirectory(uiDirectory, 'built UI bundle');
    if (!existsSync(join(uiDirectory, 'index.html'))) {
      throw new Error(`TN_UI_BUNDLE_MISSING: ${uiDirectory} has no index.html, which is the page the overlay loads.`);
    }
  } else if (uiDirectory) {
    throw new Error(`TN_UI_BUNDLE_UNEXPECTED: a UI bundle was staged for a game whose ui.renderer is '${uiRenderer}'.`);
  }
  const app = config?.app ?? {};
  const appName = app.name ?? 'ThreeNative';
  const slug = containerSlug(appName);
  const executableName2 = executableName ?? (platform === 'win32' ? `${slug}.exe` : slug);
  const iconName = app.id ?? slug;
  const rootFolder = containerRootFolder(platform, appName);
  const archive = containerArchivePath(resolve(output), platform);
  const paths = layout(platform, { appName, executableName: executableName2, iconName });
  const staging = mkdtempSync(join(tmpdir(), 'threenative-container-'));
  const resources = {};
  const stage = (relativePath) => join(staging, rootFolder, relativePath);
  const record = (relativePath) => {
    resources[relativePath] = { sha256: sha256File(stage(relativePath)) };
  };
  try {
    mkdirSync(dirname(stage(paths.executable)), { recursive: true });
    copyFileSync(executable, stage(paths.executable));
    if (platform !== 'win32') chmodSync(stage(paths.executable), 0o755);

    let ui = null;
    if (uiRenderer === 'web') {
      for (const file of listFiles(uiDirectory)) {
        const destination = `${paths.ui}/${file.relative}`;
        mkdirSync(dirname(stage(destination)), { recursive: true });
        copyFileSync(file.absolute, stage(destination));
        record(destination);
      }
      ui = { directory: paths.ui, entry: `${paths.ui}/index.html` };
      if (!existsSync(stage(ui.entry))) throw new Error('TN_UI_BUNDLE_MISSING: no index.html staged for the web renderer.');
    }

    const bundled = [];
    for (const dependency of dependencies) {
      assertFile(dependency.source, `native dependency ${dependency.name}`);
      const destination = dependencyRelativePath(platform, dependency.name);
      mkdirSync(dirname(stage(destination)), { recursive: true });
      copyFileSync(dependency.source, stage(destination));
      if (platform !== 'win32') chmodSync(stage(destination), 0o755);
      record(destination);
      bundled.push({ name: dependency.name, path: destination, sha256: resources[destination].sha256 });
    }

    let iconRecord;
    if (icon !== undefined) {
      assertFile(icon, 'app icon');
      if (platform === 'win32') {
        // Identity for Windows is the executable's PE resource section, so rcedit runs after the
        // binary is staged; the game icon also travels as a sidecar for the manifest record.
        const version = String(app.version ?? '0.0.0');
        const rcedit = run('rcedit', [
          stage(paths.executable),
          '--set-icon', icon,
          '--set-file-version', version,
          '--set-product-version', version,
          '--set-version-string', 'ProductName', appName,
          '--set-version-string', 'FileDescription', appName,
        ], {});
        if (rcedit.error) {
          throw new Error(`TN_DESKTOP_RESOURCE_TOOL_MISSING: 'rcedit' is required to embed the executable icon and version (${rcedit.error.message}).`);
        }
        if (rcedit.status !== 0) throw new Error(`TN_DESKTOP_RESOURCE_FAILED: rcedit exited ${rcedit.status ?? 'unknown'}.`);
        record(paths.executable);
        copyFileSync(icon, stage(paths.icon));
        iconRecord = { path: paths.icon, sha256: sha256File(icon) };
        record(paths.icon);
      } else {
        mkdirSync(dirname(stage(paths.icon)), { recursive: true });
        buildIcon(icon, stage(paths.icon), { platform, run });
        record(paths.icon);
        iconRecord = { path: paths.icon, sha256: resources[paths.icon].sha256 };
      }
    }

    for (const [relativePath, content] of Object.entries(containerMetadata({ config, platform }))) {
      const destination = metadataRelativePath(platform, relativePath);
      mkdirSync(dirname(stage(destination)), { recursive: true });
      writeFileSync(stage(destination), content);
      record(destination);
    }

    const manifest = {
      app: {
        id: app.id ?? 'com.threenative.game',
        name: appName,
        version: app.version ?? '0.1.0',
        build: app.build ?? 1,
        ...(iconRecord === undefined ? {} : { icon: iconRecord.path, iconSha256: iconRecord.sha256 }),
      },
      dependencies: bundled,
      executable: paths.executable,
      format,
      platform: key,
      prerequisites,
      resources,
      schemaVersion: CONTAINER_SCHEMA_VERSION,
      ui,
    };
    mkdirSync(dirname(stage(paths.manifest)), { recursive: true });
    writeFileSync(stage(paths.manifest), `${JSON.stringify(manifest, null, 2)}\n`);

    mkdirSync(dirname(archive), { recursive: true });
    archiveContainer({ output: archive, platform, rootFolder, run, staging });
    return { archive, manifest, rootFolder };
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}
