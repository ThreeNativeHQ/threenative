class Counter {
  total: number;

  constructor(start: number) {
    this.total = start;
  }

  add(n: number): void {
    this.total += n;
  }

  value(): number {
    return this.total;
  }
}

const c = new Counter(10);
c.add(5);
c.add(7);
console.log(c.value().toString());

const d = new Counter(0);
d.add(3);
console.log(d.value().toString());
