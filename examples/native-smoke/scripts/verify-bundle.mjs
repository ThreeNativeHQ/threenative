import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(import.meta.dirname, "../dist");
const files = readdirSync(dist, { recursive: true }).filter((file) => typeof file === "string");
const scripts = files.filter((file) => file.endsWith(".js"));
if (scripts.length !== 1 || scripts[0] !== "native-smoke.js") {
  throw new Error(`Expected one ESM bundle named native-smoke.js; found: ${scripts.join(", ")}`);
}

const bundle = readFileSync(resolve(dist, scripts[0]), "utf8");
for (const marker of [
  "globalThis.canvas",
  "queueFree",
  "TN_NATIVE_SMOKE_READY",
  "TN_NATIVE_SMOKE_FIRST_FRAME",
  "TN_NATIVE_SMOKE_300_FRAMES:300",
]) {
  if (!bundle.includes(marker)) throw new Error(`Native bundle is missing ${marker}`);
}
if (/^\s*import\s+/m.test(bundle) || /\bimport\s*\(/.test(bundle)) {
  throw new Error("Native bundle contains a runtime import; code splitting must remain disabled");
}
// `import.meta` is module-only syntax, and the host evaluates this bundle as a script.
// JavaScriptCore on iOS rejected the entire file for it — "SyntaxError: import.meta is only valid
// inside modules" — after the runtime had brought up its window, GPU device and JS engine, so the
// app died before its first frame with nothing in the failure naming the cause. The import checks
// above did not cover it: a bundle can carry no import statement and still not be a script.
if (/\bimport\s*\.\s*meta\b/.test(bundle)) {
  throw new Error(
    "Native bundle contains import.meta, which is only valid inside a module; the native host " +
      "evaluates this file as a script",
  );
}

console.info(
  `Verified ${scripts[0]} (${Buffer.byteLength(bundle)} bytes), one file with no imports`,
);
