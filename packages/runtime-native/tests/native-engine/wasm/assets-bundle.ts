// CMake invokes this after linking: reuse the shipped TNPK writer and catalog back end.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import {
  NativeEntryKind,
  readNativePackageManifest,
  writeNativePackage,
} from "../../../../assets/src/native-package.js";

const out = path.resolve(process.argv[2] ?? "packages/runtime-native/build/wasm");
mkdirSync(out, { recursive: true });
const positions = new Float32Array([-0.9, -0.7, 0, 0.9, -0.7, 0, 0, 0.9, 0]);
const cooked = writeNativePackage([
  {
    name: "geometry/positions",
    kind: NativeEntryKind.Buffer,
    data: new Uint8Array(positions.buffer),
    uploadSize: positions.byteLength,
  },
]);
assert.equal(readNativePackageManifest(cooked).entries.length, 1);
writeFileSync(path.join(out, "assets.tnpk"), cooked);
const result = await build({
  entryPoints: [path.join(import.meta.dirname, "assets-page.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: path.join(out, "assets-page.js"),
  metafile: true,
});
assert(
  !Object.keys(result.metafile.inputs).some((name) =>
    /(?:^|\/)node_modules\/(?:.*\/)?three\//.test(name),
  ),
  "upstream three.js in bundle inputs",
);
// Grep both emitted JS files; catalog class-name strings alone are expected.
const upstream =
  /\bREVISION\s*=\s*["']\d+|\bclass\s+WebGPURenderer\b|\bfunction\s+WebGPURenderer\s*\(/;
for (const name of ["assets-page.js", "tn-native-engine-wasm-browser.js"]) {
  assert(
    !upstream.test(readFileSync(path.join(out, name), "utf8")),
    `upstream three.js body in ${name}`,
  );
}
console.log(
  `TN_WASM_ASSETS_BUNDLE_OK: TNPK ${cooked.length} bytes; no three REVISION or WebGPURenderer bodies -> ${out}`,
);
