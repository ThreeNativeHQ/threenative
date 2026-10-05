function makeCounter(start: number): () => number {
  let count: number = start;
  return (): number => {
    count += 1;
    return count;
  };
}

const first = makeCounter(10);
const second = makeCounter(100);

console.log(first().toString());
console.log(first().toString());
console.log(second().toString());
console.log(first().toString());
