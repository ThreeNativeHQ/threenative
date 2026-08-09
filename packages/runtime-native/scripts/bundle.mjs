#!/usr/bin/env node

/**
 * Bundle Script
 *
 * Bundles JavaScript code and assets into a format that can be embedded
 * in the native binary (similar to Deno compile / pkg).
 *
 * Options:
 * 1. Generate C header with embedded data (like xxd)
 * 2. Create a virtual filesystem archive
 * 3. Use CMake's file(EMBED) feature
 *
 * Usage:
 *   node scripts/bundle.mjs --entry game.js --output dist/bundle
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Convert a buffer to a C array string
 */
function bufferToCArray(buffer, varName) {
  const bytes = Array.from(buffer);
  const lines = [];

  lines.push(`// Auto-generated - do not edit`);
  lines.push(`// Size: ${buffer.length} bytes`);
  lines.push(``);
  lines.push(`static const unsigned char ${varName}[] = {`);

  // Output 16 bytes per line
  for (let i = 0; i < bytes.length; i += 16) {
    const slice = bytes.slice(i, Math.min(i + 16, bytes.length));
    const hex = slice.map(b => `0x${b.toString(16).padStart(2, '0')}`).join(', ');
    lines.push(`    ${hex}${i + 16 < bytes.length ? ',' : ''}`);
  }

  lines.push(`};`);
  lines.push(``);
  lines.push(`static const unsigned int ${varName}_len = ${buffer.length};`);

  return lines.join('\n');
}

/**
 * Bundle a single file
 */
function bundleFile(inputPath, varName) {
  console.log(`Bundling: ${inputPath}`);
  const buffer = readFileSync(inputPath);
  return bufferToCArray(buffer, varName);
}

/**
 * Bundle a directory recursively
 */
function bundleDirectory(dirPath, prefix = '') {
  const files = [];

  for (const entry of readdirSync(dirPath)) {
    const fullPath = join(dirPath, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...bundleDirectory(fullPath, prefix + entry + '_'));
    } else {
      const varName = prefix + entry.replace(/[^a-zA-Z0-9]/g, '_');
      files.push({
        path: fullPath,
        varName,
        relativePath: (prefix + entry).replace(/_/g, '/'),
      });
    }
  }

  return files;
}

/**
 * Generate virtual filesystem header
 */
function generateVFSHeader(files, outputPath) {
  const lines = [];

  lines.push(`// Auto-generated virtual filesystem`);
  lines.push(`// Do not edit`);
  lines.push(``);
  lines.push(`#pragma once`);
  lines.push(``);
  lines.push(`#include <cstddef>`);
  lines.push(`#include <cstring>`);
  lines.push(``);
  lines.push(`namespace mystral {`);
  lines.push(`namespace vfs {`);
  lines.push(``);

  // Embed each file
  for (const file of files) {
    const buffer = readFileSync(file.path);
    lines.push(bufferToCArray(buffer, file.varName));
    lines.push(``);
  }

  // File table
  lines.push(`struct EmbeddedFile {`);
  lines.push(`    const char* path;`);
  lines.push(`    const unsigned char* data;`);
  lines.push(`    unsigned int size;`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`static const EmbeddedFile files[] = {`);

  for (const file of files) {
    lines.push(`    { "${file.relativePath}", ${file.varName}, ${file.varName}_len },`);
  }

  lines.push(`    { nullptr, nullptr, 0 }  // Sentinel`);
  lines.push(`};`);
  lines.push(``);

  // Lookup function
  lines.push(`inline const EmbeddedFile* findFile(const char* path) {`);
  lines.push(`    for (const EmbeddedFile* f = files; f->path != nullptr; ++f) {`);
  lines.push(`        if (strcmp(f->path, path) == 0) {`);
  lines.push(`            return f;`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`    return nullptr;`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`}  // namespace vfs`);
  lines.push(`}  // namespace mystral`);

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, lines.join('\n'));
  console.log(`Generated: ${outputPath}`);
}

/**
 * Main
 */
async function bundleProject(project, entryPoint, outputPath) {
  const absoluteProject = resolve(project);
  const absoluteEntry = resolve(absoluteProject, entryPoint);
  const absoluteOutput = resolve(outputPath);
  const require = createRequire(join(absoluteProject, 'package.json'));
  let viteEntry;
  try {
    viteEntry = require.resolve('vite');
  } catch {
    throw new Error(`Cannot bundle '${absoluteProject}': its pinned Vite dependency is missing.`);
  }
  const { build } = await import(pathToFileURL(viteEntry).href);
  const nativePrelude = `
const nativeElements = new Map();
const nativeGetElementById = document.getElementById.bind(document);
const nativeQuerySelector = document.querySelector.bind(document);
const nativeCreateElement = document.createElement.bind(document);
document.getElementById = (id) => nativeElements.get(id) ?? nativeGetElementById(id);
document.querySelector = (selector) =>
  selector.startsWith("#") ? nativeElements.get(selector.slice(1)) ?? null : nativeQuerySelector(selector);
document.createElement = (tag) =>
  String(tag).toLowerCase() === "canvas" ? globalThis.canvas : nativeCreateElement(tag);
for (const id of ["app", "root"]) {
  if (document.getElementById(id) == null) {
    const element = document.createElement("div");
    element.id = id;
    element.nodeType = 1;
    element.ownerDocument = document;
    element.append = (child) => element.appendChild(child);
    nativeElements.set(id, element);
    document.body?.append?.(element);
  }
}
if (typeof globalThis.requestAnimationFrame === "function") {
  const nativeRequestFrame = globalThis.requestAnimationFrame.bind(globalThis);
  let nativeFrames = 0;
  globalThis.requestAnimationFrame = (callback) => nativeRequestFrame((time) => {
    const result = callback(time);
    nativeFrames += 1;
    if (nativeFrames === 1) {
      console.info("TN_NATIVE_SMOKE_READY:webgpu");
      console.info("TN_NATIVE_SMOKE_FIRST_FRAME");
    }
    if (nativeFrames === 300) console.info("TN_NATIVE_SMOKE_300_FRAMES:300");
    return result;
  });
}`;
  const nativeEntryPlugin = {
    name: 'threenative-native-entry',
    enforce: 'pre',
    transform(source, id) {
      if (resolve(id) !== absoluteEntry) return null;
      let nativeSource = source;
      const reactRoot = nativeSource.indexOf('const root = document.getElementById("root");');
      if (reactRoot !== -1) nativeSource = nativeSource.slice(0, reactRoot);
      const start = `void game.start().catch((error) => console.error(
        \`TN_NATIVE_START_FAILED:\${error instanceof Error ? error.message : String(error)}\`,
      ));`;
      if (nativeSource.includes('void game.start();')) {
        nativeSource = nativeSource.replace('void game.start();', start);
      } else if (/^const game = defineGame/m.test(nativeSource) && !/\bgame\.start\s*\(/u.test(nativeSource)) {
        nativeSource = `${nativeSource}\n${start}\n`;
      }
      return { code: nativeSource, map: null };
    },
  };
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  await build({
    root: absoluteProject,
    plugins: [nativeEntryPlugin],
    resolve: { conditions: ['threenative-native'] },
    configFile: existsSync(join(absoluteProject, 'vite.config.ts'))
      ? join(absoluteProject, 'vite.config.ts')
      : undefined,
    build: {
      emptyOutDir: false,
      lib: {
        entry: absoluteEntry,
        fileName: () => basename(absoluteOutput),
        formats: ['es'],
      },
      minify: false,
      outDir: dirname(absoluteOutput),
      rollupOptions: { output: { banner: nativePrelude, codeSplitting: false } },
      target: 'es2022',
    },
  });
  const source = readFileSync(absoluteOutput, 'utf8');
  if (/^\s*import\s+/m.test(source) || /\bimport\s*\(/.test(source)) {
    throw new Error(`Native bundle '${absoluteOutput}' contains a runtime import.`);
  }
  console.log(`ThreeNative native bundle: ${absoluteOutput}`);
}

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let entryPoint = null;
  let assetsDir = null;
  let outputDir = 'dist';
  let project = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--entry' && args[i + 1]) {
      entryPoint = args[++i];
    } else if (args[i] === '--assets' && args[i + 1]) {
      assetsDir = args[++i];
    } else if (args[i] === '--output' && args[i + 1]) {
      outputDir = args[++i];
    } else if (args[i] === '--project' && args[i + 1]) {
      project = args[++i];
    }
  }

  if (project) {
    if (!entryPoint) throw new Error('--project requires --entry.');
    await bundleProject(project, entryPoint, outputDir);
    return;
  }

  if (!entryPoint && !assetsDir) {
    console.log('Mystral Bundle Tool');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/bundle.mjs --entry game.js [--assets assets/] [--output dist/]');
    console.log('');
    console.log('Options:');
    console.log('  --entry    Entry point JavaScript file');
    console.log('  --assets   Directory containing assets to bundle');
    console.log('  --output   Output directory (default: dist/)');
    console.log('');
    console.log('Generates a C header file with embedded data for use in native builds.');
    return;
  }

  const files = [];

  // Bundle entry point
  if (entryPoint) {
    files.push({
      path: entryPoint,
      varName: 'entry_js',
      relativePath: 'entry.js',
    });
  }

  // Bundle assets directory
  if (assetsDir) {
    files.push(...bundleDirectory(assetsDir, 'asset_'));
  }

  // Generate header
  const headerPath = join(outputDir, 'embedded_assets.h');
  generateVFSHeader(files, headerPath);

  console.log('');
  console.log('Bundle complete!');
  console.log(`Files bundled: ${files.length}`);
  console.log(`Output: ${headerPath}`);
  console.log('');
  console.log('Include in your build:');
  console.log(`  #include "${headerPath}"`);
  console.log('');
  console.log('Access files:');
  console.log('  const auto* file = mystral::vfs::findFile("entry.js");');
  console.log('  if (file) {');
  console.log('      // file->data, file->size');
  console.log('  }');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
