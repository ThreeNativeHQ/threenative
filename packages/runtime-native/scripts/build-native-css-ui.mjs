#!/usr/bin/env node

/**
 * Build the native CSS UI staticlib.
 *
 * Same shape as `build-native-ui-overlay.mjs` and for the same reason — the host links one Rust
 * staticlib per platform concern, and this one is pure Rust with no system dependency, so there
 * is no NDK, no Xcode and no `pkg-config` package to name. The one difference that matters is in
 * the failure message: the UI overlay needs webkit2gtk's development files on Linux, this crate
 * needs nothing beyond a Rust toolchain.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = join(runtimeRoot, 'native', 'css-ui', 'Cargo.toml');
const checkOnly = process.argv.includes('--check');

/** The static library `cargo build --lib` writes, named the way the host toolchain names it. */
export function cssUiLibraryName(platform = process.platform) {
  return platform === 'win32' ? 'threenative_css_ui.lib' : 'libthreenative_css_ui.a';
}

export function cssUiLibraryPath(root = runtimeRoot, platform = process.platform) {
  return join(root, 'native', 'css-ui', 'target', 'release', cssUiLibraryName(platform));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (checkOnly) {
    const library = cssUiLibraryPath();
    if (!existsSync(library)) {
      console.error(`TN_CSS_UI_MISSING: ${library}`);
      process.exitCode = 1;
    } else {
      console.log(`ThreeNative CSS UI: ${library}`);
    }
  } else {
    const result = spawnSync(
      'cargo',
      ['build', '--release', '--manifest-path', manifest, '--lib'],
      { stdio: 'inherit' },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      // This crate has no system dependency, so "cargo failed" can only mean the Rust toolchain
      // is missing or too old for the pinned blitz/Stylo graph.
      throw new Error(`Building the CSS UI failed with code ${result.status ?? 'unknown'}. It needs a current Rust toolchain and nothing else.`);
    }
    console.log(`ThreeNative CSS UI: ${cssUiLibraryPath()}`);
  }
}