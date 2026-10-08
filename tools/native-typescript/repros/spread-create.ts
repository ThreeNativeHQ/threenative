// Perry v0.5.1520: an object spread with an override is ~80x slower than V8.
//   tsx 5-11 ms, Perry 0.7-0.9 s for 400k spreads of a three-field object.
const base = { phase: 1, charges: 12, t: 0 };
let acc = 0;
const start = Date.now();
for (let i = 0; i < 400000; i++) {
  const next = { ...base, charges: i % 12 };
  acc += next.charges + next.t;
}
console.log("spread-create", acc, `${Date.now() - start} ms`);
