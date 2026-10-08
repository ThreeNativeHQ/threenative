// Perry v0.5.1520: reading fields of Object.freeze'd objects is ~140x slower than V8.
//   tsx 7-12 ms, Perry 1.4-1.7 s for 3.2M reads of two fields. Unfrozen objects of the same shape are fast.
// Environment: Perry 0.5.1520 (perry-linux-x86_64.tar.gz, sha256 3423d9fea9bce9b2011fa53b5788a5ca115c947352b5c67278147de30fd2f952),
// built with `perry compile <file> -o <exe> --strict-eval --strict-dynamic-import --strict-unimplemented`;
// reference tsx v4.23.5 on Node v20.19.6; AMD Ryzen 9 5900X. Timings are Date.now() deltas printed by the
// program itself, measured on a machine under heavy load, so read them as ranges.
// Self-contained: no imports, deterministic, identical stdout apart from the elapsed time.
const objects: { a: number; b: number }[] = [];
for (let i = 0; i < 64; i++) objects.push(Object.freeze({ a: i, b: 2 }));
let acc = 0;
const start = Date.now();
for (let round = 0; round < 50000; round++)
  for (const object of objects) acc += object.a + object.b;
console.log("frozen-read", acc, `${Date.now() - start} ms`);
