// Perry v0.5.1520: Object.freeze on a fresh literal costs ~145x what V8 pays.
//   tsx 15-22 ms, Perry 2.4-3.2 s for 400k freezes.
let acc = 0;
const start = Date.now();
for (let i = 0; i < 400000; i++) {
  const frozen = Object.freeze({ a: i, b: 2, c: 3 });
  acc += frozen.a + frozen.c;
}
console.log("freeze-create", acc, `${Date.now() - start} ms`);
