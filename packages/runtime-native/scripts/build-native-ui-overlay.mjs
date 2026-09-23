#!/usr/bin/env node

/**
 * Build the desktop UI overlay staticlib.
 *
 * Deliberately host-only and deliberately separate from `build-native-physics.mjs`: physics
 * cross-compiles to five targets because it runs on every platform, while this crate is the
 * desktop host's and each other platform has its own (Java on Android, Swift on iOS). One target,
 * no NDK, no Xcode.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(runtimeRoot, 'native', 'ui-overlay', 'Cargo.toml');
const checkOnly = process.argv.includes('--check');

export function uiOverlayLibraryPath(root = runtimeRoot) {
  return join(root, 'native', 'ui-overlay', 'target', 'release', 'libthreenative_ui_overlay.a');
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
      // Name the system dependency: on Linux this crate needs webkit2gtk's development files, and
      // a bare "cargo failed" sends the reader to the Rust code instead of to their package
      // manager.
      throw new Error(
        `Building the UI overlay failed with code ${result.status ?? 'unknown'}. ` +
          'On Linux it needs webkit2gtk-4.1 development files (pkg-config --exists webkit2gtk-4.1).',
      );
    }
    console.log(`ThreeNative UI overlay: ${uiOverlayLibraryPath()}`);
  }
}
