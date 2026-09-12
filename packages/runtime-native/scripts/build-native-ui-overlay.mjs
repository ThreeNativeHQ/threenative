#!/usr/bin/env node

/**
 * Build the desktop UI overlay staticlib.
 *
 * Deliberately host-only and deliberately separate from `build-native-physics.mjs`: physics
 * cross-compiles to five targets because it runs on every platform, while this crate is the
 * desktop host's and each other platform has its own (Java on Android, Swift on iOS). One target,
 * no NDK, no Xcode.
 *
 * The host's toolchain names the artifact differently — MSVC writes `.lib`, the rest write
 * `lib*.a` — so the name is derived once here and the C++ build asks for it rather than guessing.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(runtimeRoot, 'native', 'ui-overlay', 'Cargo.toml');
const checkOnly = process.argv.includes('--check');

/** The static library `cargo build --lib` writes, named the way the host toolchain names it. */
export function uiOverlayLibraryName(platform = process.platform) {
  return platform === 'win32' ? 'threenative_ui_overlay.lib' : 'libthreenative_ui_overlay.a';
}

export function uiOverlayLibraryPath(root = runtimeRoot, platform = process.platform) {
  return join(root, 'native', 'ui-overlay', 'target', 'release', uiOverlayLibraryName(platform));
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  if (checkOnly) {
    const library = uiOverlayLibraryPath();
    if (!existsSync(library)) {
      console.error(`TN_UI_OVERLAY_MISSING: ${library}`);
      process.exitCode = 1;
    } else {
      console.log(`ThreeNative UI overlay: ${library}`);
    }
  } else {
    const result = spawnSync(
      'cargo',
      ['build', '--release', '--manifest-path', manifest, '--lib'],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      // Name the system dependency where there is one to install: on Linux this crate needs
      // webkit2gtk's development files, and a bare "cargo failed" sends the reader to the Rust
      // code instead of to their package manager. Windows and macOS use the OS's own WebView.
      const hint =
        process.platform === 'linux'
          ? ' On Linux it needs webkit2gtk-4.1 development files '
            + '(pkg-config --exists webkit2gtk-4.1).'
          : '';
      throw new Error(
        `Building the UI overlay failed with code ${result.status ?? 'unknown'}.${hint}`,
      );
    }
    console.log(`ThreeNative UI overlay: ${uiOverlayLibraryPath()}`);
  }
}
