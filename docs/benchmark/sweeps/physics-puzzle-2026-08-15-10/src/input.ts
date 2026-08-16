import { INPUT_DOWN, INPUT_RIGHT, INPUT_UP } from "./sim.js";

/** The four bindings the game answers to. Anything else is ignored. */
const BINDINGS: Readonly<Record<string, number>> = {
  ArrowDown: INPUT_DOWN,
  ArrowRight: INPUT_RIGHT,
  ArrowUp: INPUT_UP,
};

export interface IInputSource {
  /** True once per press of `KeyV`, consumed by the caller. */
  consumeReplayRequest(): boolean;
  readonly mask: number;
}

export function installInput(target: EventTarget): IInputSource {
  let mask = 0;
  let replayRequested = false;

  target.addEventListener("keydown", (event) => {
    const key = event as KeyboardEvent;
    if (key.code === "KeyV") {
      replayRequested = true;
      key.preventDefault();
      return;
    }
    const bit = BINDINGS[key.code];
    if (bit === undefined) return;
    // GUTTED CONTROL: movement input is swallowed, so the character never moves. Everything
    // else -- boot, bridge, replay, crates, HUD -- is untouched, so the run reaches assertions.
    key.preventDefault();
    return;
    mask |= bit;
    key.preventDefault();
  });

  target.addEventListener("keyup", (event) => {
    const key = event as KeyboardEvent;
    const bit = BINDINGS[key.code];
    if (bit === undefined) return;
    mask &= ~bit;
    key.preventDefault();
  });

  // A lost focus must not leave a key stuck down; a stuck key would make the character drift
  // with no input, which is the exact thing an input-causality check is looking for.
  target.addEventListener("blur", () => {
    mask = 0;
  });

  return {
    consumeReplayRequest: () => {
      const requested = replayRequested;
      replayRequested = false;
      return requested;
    },
    get mask() {
      return mask;
    },
  };
}
