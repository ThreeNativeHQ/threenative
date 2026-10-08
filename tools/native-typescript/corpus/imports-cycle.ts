import { ping } from "./imports-cycle-inner";

const result = ping(3);
console.log(result.toString());
