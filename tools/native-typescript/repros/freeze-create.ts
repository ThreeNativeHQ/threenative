// Perry v0.5.1520: Object.freeze on a fresh literal costs ~145x what V8 pays.
//   tsx 15-22 ms, Perry 2.4-3.2 s for 400k freezes.
// Environment: Perry 0.5.1520 (perry-linux-x86_64.tar.gz, sha256 3423d9fea9bce9b2011fa53b5788a5ca115c947352b5c67278147de30fd2f952),
// built with `perry compile <file> -o <exe> --strict-eval --strict-dynamic-import --strict-unimplemented`;
// reference tsx v4.23.5 on Node v20.19.6; AMD Ryzen 9 5900X. Timings are Date.now() deltas printed by the
// program itself, measured on a machine under heavy load, so read them as ranges.
// Self-contained: no imports, deterministic, identical stdout apart from the elapsed time.
let acc = 0;
const start = Date.now();
for (let i = 0; i < 400000; i++) {
  const frozen = Object.freeze({ a: i, b: 2, c: 3 });
  acc += frozen.a + frozen.c;
}
console.log("freeze-create", acc, `${Date.now() - start} ms`);
