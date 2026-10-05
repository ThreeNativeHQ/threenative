// PRD-532: the browser-JS back end over the real Wasm ABI (tn-native-engine-abi-module), under node.
//   tsx tests/browser-backend-smoke.ts <path to tn-native-engine-abi-module.js>
// Prints TN_BROWSER_BACKEND_OK and exits 0 when every check holds; names the first that fails.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type * as THREE from "three";

import {
  type IRegistryDump,
  type TnAbiModule,
  createWasmRuntime,
  defineBrowserClasses,
} from "../src/browser-backend.js";

const modulePath = process.argv[2];
if (modulePath === undefined) throw new Error("usage: browser-backend-smoke.ts <abi module .js>");
const createTnAbi = createRequire(import.meta.url)(
  path.resolve(modulePath),
) as () => Promise<TnAbiModule>;
const registry = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "..", "api", "native-registry.json"), "utf8"),
) as IRegistryDump;

// The back end mirrors three's API, so three's declarations type it.
const { BoxGeometry, Mesh, MeshStandardMaterial, Vector3 } = defineBrowserClasses(
  registry,
  createWasmRuntime(await createTnAbi()),
) as unknown as typeof THREE;

function check(condition: boolean, what: string): void {
  if (!condition) {
    process.stderr.write(`TN_BROWSER_BACKEND_FAILED: ${what}\n`);
    process.exit(1);
  }
}

const v = new Vector3(1, 2, 3);
check(v.add(new Vector3(1, 1, 1)) === v, "a chaining method returns its own wrapper");
check(v.x === 2 && v.y === 3 && v.z === 4, `Vector3.add (${v.x}, ${v.y}, ${v.z})`);
v.x = 7;
check(v.x === 7, "a setter reaches the engine");

const material = new MeshStandardMaterial();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
const position = mesh.position;
check(position === mesh.position, "a member object keeps one identity");
mesh.position.x = 5;
mesh.updateMatrixWorld();
check(
  mesh.matrixWorld.elements[12] === 5,
  `matrixWorld.elements[12] is ${mesh.matrixWorld.elements[12]}`,
);
check(mesh.material === material, "the material member is the constructor's material");
material.color.r = 0.25;
check(
  (mesh.material as THREE.MeshStandardMaterial).color.r === 0.25,
  "a member chain writes through",
);
const geometry = mesh.geometry;
check(geometry === mesh.geometry, "the geometry member keeps one identity");
let refused = "";
try {
  mesh.applyMatrix4("not a matrix" as never);
} catch (error) {
  refused = String(error);
}
check(refused.includes("TN_ABI_"), `an engine refusal surfaces as an error (${refused || "none"})`);
process.stdout.write("TN_BROWSER_BACKEND_OK\n");
