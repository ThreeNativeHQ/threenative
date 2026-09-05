import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dirname, "..");
await mkdir(path.join(packageRoot, "dist"), { recursive: true });
await copyFile(
  path.join(packageRoot, "vendor/basis-encoder/basis_encoder.wasm"),
  path.join(packageRoot, "dist/basis_encoder.wasm"),
);
