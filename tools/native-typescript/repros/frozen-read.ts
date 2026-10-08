// Perry v0.5.1520: reading fields of Object.freeze'd objects is ~140x slower than V8.
//   tsx 7-12 ms, Perry 1.4-1.7 s for 3.2M reads of two fields. Unfrozen objects of the same shape are fast.
const objects: { a: number; b: number }[] = [];
for (let i = 0; i < 64; i++) objects.push(Object.freeze({ a: i, b: 2 }));
let acc = 0;
const start = Date.now();
for (let round = 0; round < 50000; round++)
  for (const object of objects) acc += object.a + object.b;
console.log("frozen-read", acc, `${Date.now() - start} ms`);
