import { readFileSync } from "node:fs";
function clipNames(path) {
  const buf = readFileSync(path);
  let off = 12, g;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) g = JSON.parse(buf.subarray(off + 8, off + 8 + len).toString("utf8"));
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  return (g.animations ?? []).map((a) => a.name);
}
const [oldDir, newDir] = process.argv.slice(2);
for (const animal of ["SK_Crow", "SK_DeerDoe", "SK_DeerStag", "SK_Fox", "SK_Pig", "SK_Wolf"]) {
  const before = new Set(clipNames(`${oldDir}/${animal}.glb`));
  const after = new Set(clipNames(`${newDir}/${animal}.glb`));
  const lost = [...before].filter((n) => !after.has(n));
  console.log(`${animal.padEnd(12)} before=${String(before.size).padStart(2)} after=${String(after.size).padStart(2)} lost=${lost.length ? lost.join(",") : "none"}`);
}
