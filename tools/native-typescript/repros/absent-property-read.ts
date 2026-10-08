// Perry v0.5.1520: reading a property an object does not have is ~150-270x slower than V8 once the
// reads spread over many object literals of one shape. perf on the binary puts js_object_get_field_ic_miss,
// js_string_equals and shape_descriptor_by_id on top, which points at the missing-key lookup path.
//   tsx 6-14 ms, Perry 1.9-3.8 s for 3.2M reads (two runs, a loaded and a quiet machine). The same read
// on ONE object takes 10 ms, so the cost is per object, not per read.
// Game code does this on every optional state field: `state.hp ?? 100`, `state.rpm ?? state.throttle`.
// Run: tsx absent-property-read.ts  and  perry compile absent-property-read.ts -o t && ./t
// Environment: Perry 0.5.1520 (perry-linux-x86_64.tar.gz, sha256 3423d9fea9bce9b2011fa53b5788a5ca115c947352b5c67278147de30fd2f952),
// built with `perry compile <file> -o <exe> --strict-eval --strict-dynamic-import --strict-unimplemented`;
// reference tsx v4.23.5 on Node v20.19.6; AMD Ryzen 9 5900X. Timings are Date.now() deltas printed by the
// program itself, measured on a machine under heavy load, so read them as ranges.
// Self-contained: no imports, deterministic, identical stdout apart from the elapsed time.
interface IState {
  vx: number;
  hp?: number;
}
const states: IState[] = [];
for (let i = 0; i < 64; i++) states.push({ vx: i });
let acc = 0;
const start = Date.now();
for (let round = 0; round < 50000; round++) for (const state of states) acc += state.hp ?? 100;
console.log("absent-property-read", acc, `${Date.now() - start} ms`);
