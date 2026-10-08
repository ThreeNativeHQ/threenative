class Shape {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  describe(): string {
    return this.name;
  }
}

class Square extends Shape {
  side: number;

  constructor(side: number) {
    super("square");
    this.side = side;
  }

  area(): number {
    return this.side * this.side;
  }

  describe(): string {
    return `${super.describe()}:${this.area().toString()}`;
  }
}

class Circle extends Shape {
  constructor() {
    super("circle");
  }
}

const s = new Square(4);
console.log(s.describe());
console.log(s.area().toString());

const shape: Shape = s;
console.log(shape.describe());

const c = new Circle();
console.log(c.describe());
