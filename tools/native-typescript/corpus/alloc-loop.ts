class Box {
  value: number;

  constructor(value: number) {
    this.value = value;
  }
}

let checksum = 0.0;
for (let i = 0; i < 5000000; i++) {
  const b = new Box(i);
  checksum = (checksum + b.value) % 1000003;
}
console.log(checksum.toString());
