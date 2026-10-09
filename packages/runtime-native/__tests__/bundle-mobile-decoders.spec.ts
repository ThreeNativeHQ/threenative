import { execFile } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

const run = promisify(execFile);
const bundlerScript = path.resolve("packages/runtime-native/scripts/bundle.mjs");
const viteInstall = path.resolve("packages/create-threenative/node_modules/vite");

/** A stand-in `three` whose three decoder modules sit at the paths the stub plugin matches. */
async function project(): Promise<string> {
  const root = path.join(await makeTempDir("threenative-mobile-decoders-"), "project");
  const three = path.join(root, "node_modules/three");
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(three, "examples/jsm/loaders"), { recursive: true });
  await mkdir(path.join(three, "examples/jsm/libs"), { recursive: true });
  await symlink(viteInstall, path.join(root, "node_modules/vite"));
  await writeFile(path.join(root, "package.json"), '{"name":"decoders","type":"module"}\n');
  await writeFile(path.join(three, "package.json"), '{"name":"three","type":"module"}\n');
  await writeFile(
    path.join(three, "examples/jsm/loaders/KTX2Loader.js"),
    'export class KTX2Loader { kind() { return "real-ktx2"; } }\n',
  );
  await writeFile(
    path.join(three, "examples/jsm/libs/meshopt_decoder.module.js"),
    'export const MeshoptDecoder = { kind: "real-meshopt" };\n',
  );
  await writeFile(
    path.join(three, "examples/jsm/loaders/DRACOLoader.js"),
    'export class DRACOLoader { kind() { return "real-draco"; } }\n',
  );
  await writeFile(
    path.join(root, "src/game.ts"),
    `import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
export default { start() { globalThis.used = [KTX2Loader, MeshoptDecoder, DRACOLoader]; return Promise.resolve(); } };
`,
  );
  return root;
}

async function bundle(root: string, extra: string[]): Promise<string> {
  const output = path.join(root, "dist/android.js");
  await run(
    process.execPath,
    [bundlerScript, "--project", root, "--entry", "src/game.ts", "--target", "android"]
      .concat(["--output", output])
      .concat(extra),
    { cwd: root },
  );
  return readFile(output, "utf8");
}

test("an Android bundle keeps the real loader only for the codecs --decoders admits", async () => {
  const root = await project();
  const stubbed = await bundle(root, []);
  expect(stubbed).toContain("TN_NATIVE_KTX2_UNSUPPORTED");
  expect(stubbed).toContain("TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED");
  expect(stubbed).not.toMatch(/real-ktx2|real-meshopt|real-draco/u);

  const admitted = await bundle(root, ["--decoders", "ktx2,meshopt"]);
  expect(admitted).toContain("real-ktx2");
  expect(admitted).toContain("real-meshopt");
  expect(admitted).not.toContain("TN_NATIVE_KTX2_UNSUPPORTED");
  // Draco is not admitted, so its stub (which shares the mesh message) still replaces it.
  expect(admitted).not.toContain("real-draco");
  expect(admitted).toContain("TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED");
}, 60_000);

test("--decoders refuses a codec name it does not know", async () => {
  const root = await project();
  await expect(bundle(root, ["--decoders", "ktx2,basis"])).rejects.toThrow(
    /unknown codec\(s\): basis/u,
  );
}, 60_000);
