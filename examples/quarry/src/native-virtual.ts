// One native entry per arm. The native bundler takes the game from a module's default export and
// has no URL to read a selector out of, so the arm is chosen by which entry was bundled.
import { createQuarryGame } from "./game.js";

export default createQuarryGame({ arm: "virtual", mode: "route" });
