type Mode = "idle" | "run";

function label(m: Mode): string {
  if (m === "idle") return "IDLE";
  if (m === "run") return "RUN";
  return "?";
}

enum Color {
  Red = 0,
  Green = 1,
  Blue = 2,
}

function pick(c: Color): string {
  switch (c) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    default:
      return "blue";
  }
}

const m: Mode = "run";
console.log(label(m));
console.log(label("idle"));
console.log(pick(Color.Green));
console.log(pick(Color.Red));
