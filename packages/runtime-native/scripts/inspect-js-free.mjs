#!/usr/bin/env node
// Gate E/T inspector (PRD-499): proves a binary is JS-free from its symbols, its dynamic
// dependencies, its embedded strings and its packaged resources together. A `.js` filename scan
// proves nothing, since a binary can embed a VM. Fails closed: a tool that cannot run is a failure.
//
//   node scripts/inspect-js-free.mjs --binary <file> [--resources <dir>] [--manifest <out.json>]
//                                    [--target <name>] [--capability <name> ...]

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** Symbol families of every JS engine and web view the native engine must not carry. */
export const VM_SYMBOL_FAMILIES = [
  { family: "v8", pattern: /\bv8::|\bv8_inspector::|\bV8_Fatal\b/ },
  { family: "quickjs", pattern: /\bJS_(NewRuntime|NewContext|Eval|FreeRuntime)\b|\bquickjs\b/i },
  { family: "javascriptcore", pattern: /\bJSGlobalContext\w*|\bJSEvaluateScript\b|\bJSC::/ },
  { family: "hermes", pattern: /\bhermes::|\bfacebook::hermes\b/ },
  { family: "webview", pattern: /\bwebkit_web_view\w*|\bWKWebView\b|\bICoreWebView2\w*/ },
  { family: "embedded-runtime-scripts", pattern: /\bmystral::runtime_scripts::/ },
];

/** Shared libraries that load a VM or a web view. */
export const VM_LIBRARY = /(^|\/)(lib)?(v8|v8_libplatform|quickjs|JavaScriptCore|javascriptcoregtk[\w.-]*|hermes|webkit2gtk[\w.-]*|WebView2Loader)(\.|$)/i;

/** Bundler output that only an embedded script blob would put in a native binary. */
export const SCRIPT_MARKERS = ["//# sourceMappingURL=", "Object.defineProperty(exports, \"__esModule\"", "__webpack_require__", "\"use strict\";\n"];

/** Packaged files that are scripts, VM snapshots or bytecode. */
export const SCRIPT_RESOURCE = /\.(m?js|cjs|jsbundle|hbc)$|(^|\/)(snapshot_blob|natives_blob)\.bin$/;

export function findSymbolFindings(symbols) {
  const findings = [];
  for (const { family, pattern } of VM_SYMBOL_FAMILIES) {
    const hit = symbols.find((symbol) => pattern.test(symbol));
    if (hit) findings.push({ kind: "symbol", family, evidence: hit });
  }
  return findings;
}

export function findLibraryFindings(libraries) {
  return libraries.filter((lib) => VM_LIBRARY.test(lib)).map((lib) => ({ kind: "library", evidence: lib }));
}

export function findScriptMarkers(bytes) {
  const text = bytes.toString("latin1");
  return SCRIPT_MARKERS.filter((marker) => text.includes(marker)).map((marker) => ({
    kind: "embedded-script",
    evidence: JSON.stringify(marker),
  }));
}

export function findResourceFindings(files) {
  return files.filter((file) => SCRIPT_RESOURCE.test(file)).map((file) => ({ kind: "resource", evidence: file }));
}

function run(tool, args) {
  try {
    return execFileSync(tool, args, { encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error(`TN_JS_FREE_TOOL_FAILED: ${tool} ${args.join(" ")}: ${error.message}`);
  }
}

function readSymbols(binary) {
  if (process.platform === "win32") throw new Error("TN_JS_FREE_UNSUPPORTED_HOST: dumpbin inspection is not wired yet");
  // Defined and undefined symbols both count: an import of v8:: is as much a VM as a definition.
  const out = run("nm", process.platform === "darwin" ? ["-C", binary] : ["-C", "--no-sort", binary]);
  return out.split("\n").filter(Boolean);
}

function readLibraries(binary) {
  if (process.platform === "darwin") {
    return run("otool", ["-L", binary]).split("\n").slice(1).map((line) => line.trim().split(" ")[0]).filter(Boolean);
  }
  const out = run("readelf", ["-d", binary]);
  return [...out.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map((match) => match[1]);
}

function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(relative(root, path));
    }
  };
  walk(root);
  return files;
}

export function inspect({ binary, resources }) {
  const bytes = readFileSync(binary);
  const symbols = readSymbols(binary);
  if (symbols.length === 0) throw new Error(`TN_JS_FREE_NO_SYMBOLS: ${binary} has no symbol table to inspect`);
  const libraries = readLibraries(binary);
  const findings = [
    ...findSymbolFindings(symbols),
    ...findLibraryFindings(libraries),
    ...findScriptMarkers(bytes),
    ...(resources ? findResourceFindings(listFiles(resources)) : []),
  ];
  return {
    binary,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    symbolCount: symbols.length,
    libraries,
    resourcesInspected: Boolean(resources),
    backend: symbols.some((s) => /\bdawn::native::|\bdawn::wire::/.test(s))
      ? "dawn"
      : symbols.some((s) => /\bwgpu_|wgpuGetVersion/.test(s))
        ? "wgpu-native"
        : "unknown",
    findings,
    jsFree: findings.length === 0,
  };
}

function parseArgs(argv) {
  const options = { capabilities: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--binary") options.binary = value;
    else if (flag === "--resources") options.resources = value;
    else if (flag === "--manifest") options.manifest = value;
    else if (flag === "--target") options.target = value;
    else if (flag === "--capability") options.capabilities.push(value);
    else throw new Error(`TN_JS_FREE_BAD_ARGUMENT: ${flag}`);
    i += 1;
  }
  if (!options.binary) throw new Error("TN_JS_FREE_BAD_ARGUMENT: --binary <file> is required");
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = {
      ...inspect(options),
      target: options.target ?? null,
      capabilities: options.capabilities,
      inspectedAt: new Date().toISOString(),
    };
    if (options.manifest) {
      mkdirSync(dirname(options.manifest), { recursive: true });
      writeFileSync(options.manifest, `${JSON.stringify(report, null, 2)}\n`);
    }
    for (const finding of report.findings) {
      console.error(`TN_JS_FREE_FINDING ${finding.kind}${finding.family ? `/${finding.family}` : ""}: ${finding.evidence}`);
    }
    console.log(`${report.jsFree ? "JS_FREE_OK" : "JS_FREE_FAIL"} ${report.binary} sha256=${report.sha256} backend=${report.backend}`);
    process.exitCode = report.jsFree ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
