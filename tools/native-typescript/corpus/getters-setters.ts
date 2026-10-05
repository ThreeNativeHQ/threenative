class Temperature {
  private celsius: number;

  constructor(celsius: number) {
    this.celsius = celsius;
  }

  get fahrenheit(): number {
    return (this.celsius * 9) / 5 + 32;
  }

  set fahrenheit(value: number) {
    this.celsius = ((value - 32) * 5) / 9;
  }

  get value(): number {
    return this.celsius;
  }
}

const t = new Temperature(0);
console.log(t.fahrenheit.toString());

t.fahrenheit = 212;
console.log(t.value.toString());
