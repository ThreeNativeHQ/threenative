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
  "TN_NATIVE_SMOKE_READY",
  "TN_NATIVE_SMOKE_FIRST_FRAME",
  "TN_NATIVE_SMOKE_300_FRAMES:300",
]) {
  if (!bundle.includes(marker)) throw new Error(`Native bundle is missing ${marker}`);
}
if (/^\s*import\s+/m.test(bundle) || /\bimport\s*\(/.test(bundle)) {
  throw new Error("Native bundle contains a runtime import; code splitting must remain disabled");
}

console.info(
  `Verified ${scripts[0]} (${Buffer.byteLength(bundle)} bytes), one file with no imports`,
);
