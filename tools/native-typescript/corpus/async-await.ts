async function inc(n: number): number {
  return n + 1;
}

async function twice(n: number): number {
  const a = await inc(n);
  const b = await inc(a);
  return b;
}

const a = await inc(0);
console.log(a.toString());

const b = await twice(a);
console.log(b.toString());

const c = await twice(b);
console.log(c.toString());
