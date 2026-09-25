import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Explicit opt-in source installation, not a new threenative CLI command or runtime dependency.
const source = fileURLToPath(new URL("./src/", import.meta.url));
const destination = path.resolve(process.argv[2] ?? process.cwd(), "src");
const files = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative);
    else files.push(relative);
  }
}
await walk(source);
// Preflight all names before the first copy. Existing game source must never be overwritten.
for (const relative of files) {
  const target = path.join(destination, relative);
  try {
    await lstat(target);
    throw new Error(`Refusing to overwrite ${target}. Move or review the existing source first.`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
for (const relative of files) {
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(path.join(source, relative), target, { errorOnExist: true, force: false });
}
console.log(`Installed Clearwater source into ${destination}. Import createClearwater from ./clearwater.js.`);
