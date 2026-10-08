// Perry v0.5.1520: an object spread with an override is ~80x slower than V8.
//   tsx 5-11 ms, Perry 0.7-0.9 s for 400k spreads of a three-field object.
// Environment: Perry 0.5.1520 (perry-linux-x86_64.tar.gz, sha256 3423d9fea9bce9b2011fa53b5788a5ca115c947352b5c67278147de30fd2f952),
// built with `perry compile <file> -o <exe> --strict-eval --strict-dynamic-import --strict-unimplemented`;
// reference tsx v4.23.5 on Node v20.19.6; AMD Ryzen 9 5900X. Timings are Date.now() deltas printed by the
// program itself, measured on a machine under heavy load, so read them as ranges.
// Self-contained: no imports, deterministic, identical stdout apart from the elapsed time.
const base = { phase: 1, charges: 12, t: 0 };
let acc = 0;
const start = Date.now();
for (let i = 0; i < 400000; i++) {
  const next = { ...base, charges: i % 12 };
  acc += next.charges + next.t;
}
console.log("spread-create", acc, `${Date.now() - start} ms`);
