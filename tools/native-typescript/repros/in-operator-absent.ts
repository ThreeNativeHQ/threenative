// Perry v0.5.1520: `"key" in object` for a missing key, same cliff as absent-property-read.ts.
//   tsx 6-11 ms, Perry 1.5-2.6 s for 3.2M tests.
const states: { vx: number; hp?: number }[] = [];
for (let i = 0; i < 64; i++) states.push({ vx: i });
let acc = 0;
const start = Date.now();
for (let round = 0; round < 50000; round++)
  for (const state of states) acc += "hp" in state ? 1 : 100;
console.log("in-operator-absent", acc, `${Date.now() - start} ms`);
