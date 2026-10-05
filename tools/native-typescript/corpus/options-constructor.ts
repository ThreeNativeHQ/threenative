interface RectangleOptions {
  width: number;
  height: number;
  label?: string;
}

class Rectangle {
  width: number;
  height: number;
  label: string;

  constructor(options: RectangleOptions) {
    this.width = options.width;
    this.height = options.height;
    this.label = options.label !== undefined ? options.label : "rect";
  }

  area(): number {
    return this.width * this.height;
  }
}

const a = new Rectangle({ width: 3, height: 4 });
console.log(a.area().toString());
console.log(a.label);

const b = new Rectangle({ width: 5, height: 6, label: "big" });
console.log(b.area().toString());
console.log(b.label);
