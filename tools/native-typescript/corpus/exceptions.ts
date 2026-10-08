function halve(n: number): number {
  if (n % 2 !== 0) throw new Error("odd");
  return n / 2;
}

for (let i = 1; i <= 4; i++) {
  const n: number = i;
  try {
    console.log(halve(n).toString());
  } catch (e) {
    console.log(`odd: ${n.toString()}`);
  }
}

function nested(): number {
  try {
    return halve(3);
  } catch (e) {
    return -1;
  }
}

console.log(nested().toString());
