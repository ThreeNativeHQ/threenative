// Perry v0.5.1520: reading a property an object does not have is ~150-270x slower than V8 once the
// reads spread over many object literals of one shape (the inline cache only holds hits).
//   tsx 6-14 ms, Perry 1.9-3.8 s for 3.2M reads (two runs, a loaded and a quiet machine). The same read
// on ONE object takes 10 ms, so the cost is per object, not per read.
// Game code does this on every optional state field: `state.hp ?? 100`, `state.rpm ?? state.throttle`.
// Run: tsx absent-property-read.ts  and  perry compile absent-property-read.ts -o t && ./t
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
