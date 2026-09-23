/**
 * WebP must be provisionable for every platform a game can ship textures to.
 *
 * This is the drift guard for a failure that reached a physical Pixel 8 twice: a
 * GLB carrying EXT_texture_webp textures loads every mesh but drops every
 * texture, because the Android runtime was built without libwebp. The symptom is
 * untextured white models plus one logcat line — nothing fails at build time.
 *
 * Three files must stay in sync or the white-models failure returns:
 *   1. scripts/download-deps.mjs  — provisions the libwebp source for Android.
 *   2. CMakeLists.txt             — builds it into the runtime under ANDROID.
 *   3. scripts/asset-preflight.mjs — fails closed while the capability is absent.
 * Each test names which leg of that triangle it pins.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const depsScript = readFileSync(join(root, 'scripts/download-deps.mjs'), 'utf8');
const cmakeLists = readFileSync(join(root, 'CMakeLists.txt'), 'utf8');
const preflight = readFileSync(join(root, 'scripts/asset-preflight.mjs'), 'utf8');
/** Comments record why the stale claim was wrong; the guard below must read code, not prose. */
const preflightCode = preflight.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function androidDeps() {
  const match = depsScript.match(/const androidDeps = \[([^\]]*)\]/);
  if (match === null) throw new Error('androidDeps list not found in download-deps.mjs');
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0);
}

/** The version literal of a DEPS entry, e.g. `'1.5.0'`, read out of its source. */
function depsVersion(name) {
  const escaped = name.replace(/[-]/g, '\\-');
  const key = depsScript.match(new RegExp(`(['"]?)${escaped}\\1: \\{`));
  if (key === null) throw new Error(`DEPS.${name} entry not found in download-deps.mjs`);
  const window = depsScript.slice(key.index, key.index + 800);
  const version = window.match(/version: '([^']+)'/);
  if (version === null) throw new Error(`DEPS.${name} has no version literal`);
  return version[1];
}

test('download-deps provisions libwebp source for Android', () => {
  if (!androidDeps().includes('webp-source')) {
    throw new Error(
      "androidDeps omits 'webp-source'; an --android checkout cannot build a " +
        'WebP-capable runtime and games with EXT_texture_webp render white models.',
    );
  }
});

test('the webp-source entry points at the upstream release tarball', () => {
  const url = depsScript.match(/libwebp-\$\{DEPS\['webp-source'\]\.version\}\.tar\.gz/);
  if (url === null) {
    throw new Error('DEPS.webp-source no longer fetches the upstream libwebp source tarball');
  }
});

test('desktop prebuilt and Android source track the same libwebp release', () => {
  const desktop = depsVersion('webp');
  const source = depsVersion('webp-source');
  if (desktop !== source) {
    throw new Error(`DEPS.webp (${desktop}) and DEPS['webp-source'] (${source}) drifted apart`);
  }
});

test('CMake builds libwebp from source under ANDROID and defines MYSTRAL_HAS_WEBP', () => {
  const webpBlock = cmakeLists.match(/# libwebp[\s\S]*?# Skia/);
  if (webpBlock === null) throw new Error('libwebp block not found in CMakeLists.txt');
  const block = webpBlock[0];
  if (!/^if\(ANDROID\)/m.test(block)) {
    throw new Error('CMakeLists.txt lost the ANDROID branch of the libwebp block');
  }
  if (!block.includes('MYSTRAL_HAS_WEBP')) {
    throw new Error('the ANDROID libwebp branch no longer defines MYSTRAL_HAS_WEBP; ' +
      'runtime.cpp would report "WebP format support: NO" on Android again');
  }
  // The shared link block keys on TARGET webp::webp; the Android branch must
  // provide that name or the built library silently links nowhere.
  if (!block.includes('webp::webp')) {
    throw new Error('ANDROID libwebp branch no longer provides the webp::webp target name');
  }
});

test('the Android failure hint names the command that fixes it', () => {
  const hint = cmakeLists.match(/libwebp not found[^"]*"\s*\.\s*"?\s*Run '[^']*'[^.]*\./);
  if (hint !== null && !hint[0].includes('webp-source')) {
    throw new Error("the configure-time hint regressed to '--only webp', which does not exist for Android");
  }
});

test('asset-preflight derives WebP support from the build rather than declaring it', () => {
  // Leg 3, and the reason this test file names three legs. The preflight used to refuse every
  // WebP texture with "the android runtime is built without libwebp", a sentence that had been
  // false since 62fac4d5 added webp-source to androidDeps. Legs 1 and 2 above were pinned and
  // leg 3 was not, so the build changed and the claim about the build did not.
  if (/built without libwebp/.test(preflightCode)) {
    throw new Error(
      'asset-preflight.mjs hardcodes "built without libwebp" again; it must derive support from ' +
        'the runtime source facts CMake reads, through deriveAndroidWebpSupport',
    );
  }
  if (!/export function deriveAndroidWebpSupport/.test(preflight)) {
    throw new Error('asset-preflight.mjs no longer exports deriveAndroidWebpSupport');
  }
  // The derivation must read the same directory CMake globs, or the two drift apart silently.
  if (!/third_party.*webp-source/s.test(preflight)) {
    throw new Error('deriveAndroidWebpSupport no longer reads third_party/webp-source');
  }
});

test('the iOS exclusion stays honest: no libwebp is built for IOS', () => {
  // CMakeLists.txt:697 excludes IOS from the prebuilt branch and the source branch is ANDROID
  // only, so iOS genuinely cannot decode WebP. Correcting the Android claim must not quietly
  // make the iOS one wrong in the other direction.
  if (!/elseif\(EXISTS \$\{WEBP_DIR\} AND NOT IOS\)/.test(cmakeLists)) {
    throw new Error(
      'the libwebp prebuilt branch no longer excludes IOS; either iOS gained a decoder and the ' +
        "preflight must say so, or the exclusion regressed",
    );
  }
});
