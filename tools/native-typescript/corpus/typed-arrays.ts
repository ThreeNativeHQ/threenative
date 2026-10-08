const ints = new Int32Array([3, 1, 4, 1, 5, 9, 2, 6]);
let sum = 0.0;
for (let i = 0; i < ints.length; i++) {
  const v: number = ints[i];
  sum += v;
}
console.log(sum.toString());

const floats = new Float64Array([1.5, 2.25, 3.0]);
let fsum = 0.0;
for (let i = 0; i < floats.length; i++) {
  const v: number = floats[i];
  fsum += v;
}
console.log(fsum.toString());

const bytes = new Uint8Array([250, 5, 1]);
let bsum = 0.0;
for (let i = 0; i < bytes.length; i++) {
  const v: number = bytes[i];
  bsum += v;
}
console.log(bsum.toString());
