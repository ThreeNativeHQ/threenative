import { Vector2 } from "three";

export interface InputAction {
  readonly buttons?: readonly number[];
  readonly down?: readonly string[];
  readonly left?: readonly string[];
  readonly pointer?: boolean;
  readonly right?: readonly string[];
  readonly up?: readonly string[];
}

export type InputBindings = Record<string, InputAction>;

export interface RawInputState {
  readonly keys: ReadonlySet<string>;
  readonly pointer: {
    buttons: number;
    down: boolean;
    readonly position: Vector2;
  };
  readonly gamepad: {
    axes: readonly number[];
    buttons: readonly boolean[];
  };
}

const DEFAULT_BINDINGS: InputBindings = {
  move: {
    down: ["KeyS", "ArrowDown"],
    left: ["KeyA", "ArrowLeft"],
    right: ["KeyD", "ArrowRight"],
    up: ["KeyW", "ArrowUp"],
  },
};

function eventCode(event: Event): string | undefined {
  const candidate = event as Event & { code?: string; key?: string };
  return candidate.code ?? candidate.key;
}

export class InputMap {
  readonly raw: RawInputState;
  #bindings: InputBindings;
  #target: EventTarget;
  #heldKeys = new Set<string>();
  #pointerPosition = new Vector2();
  #pointerDown = false;
  #pointerButtons = 0;
  #gamepadAxes: number[] = [];
  #gamepadButtons: boolean[] = [];
  #previousPressed = new Map<string, boolean>();
  #justPressed = new Set<string>();
  #justReleased = new Set<string>();
  #pointerTarget: EventTarget;
  #listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    bindings: InputBindings = DEFAULT_BINDINGS,
    target: EventTarget = globalThis,
    pointerTarget: EventTarget = target,
  ) {
    this.#bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.#target = target;
    this.#pointerTarget = pointerTarget;
    this.raw = {
      gamepad: { axes: this.#gamepadAxes, buttons: this.#gamepadButtons },
      keys: this.#heldKeys,
      pointer: {
        buttons: this.#pointerButtons,
        down: this.#pointerDown,
        position: this.#pointerPosition,
      },
    };
    this.#listen(this.#target, "keydown", (event) => {
      const code = eventCode(event);
      if (code !== undefined) this.#heldKeys.add(code);
    });
    this.#listen(this.#target, "keyup", (event) => {
      const code = eventCode(event);
      if (code !== undefined) this.#heldKeys.delete(code);
    });
    this.#listen(this.#pointerTarget, "pointerdown", (event) => this.#pointerEvent(event, true));
    this.#listen(this.#pointerTarget, "pointermove", (event) =>
      this.#pointerEvent(event, this.#pointerDown),
    );
    this.#listen(this.#pointerTarget, "pointerup", (event) => this.#pointerEvent(event, false));
    this.#listen(this.#target, "blur", () => this.clear());
  }

  vector(name: string): Vector2 {
    const binding = this.#bindings[name];
    if (binding === undefined) return new Vector2();
    const vector = new Vector2(
      this.#isHeld(binding.left) ? -1 : 0,
      this.#isHeld(binding.down) ? -1 : 0,
    );
    if (this.#isHeld(binding.right)) vector.x += 1;
    if (this.#isHeld(binding.up)) vector.y += 1;
    if (name === "move" && this.#gamepadAxes.length >= 2) {
      vector.x += this.#gamepadAxes[0] ?? 0;
      vector.y += -(this.#gamepadAxes[1] ?? 0);
    }
    return vector.clampLength(0, 1);
  }

  pressed(name: string): boolean {
    const binding = this.#bindings[name];
    if (binding === undefined) return false;
    return (
      this.#isHeld(binding.down) ||
      this.#isHeld(binding.left) ||
      this.#isHeld(binding.right) ||
      this.#isHeld(binding.up) ||
      (binding.pointer === true && this.#pointerDown) ||
      (binding.buttons?.some((button) => this.#gamepadButtons[button] === true) ?? false)
    );
  }

  justPressed(name: string): boolean {
    return this.#justPressed.has(name);
  }

  justReleased(name: string): boolean {
    return this.#justReleased.has(name);
  }

  tick(): void {
    const getGamepads = (
      globalThis.navigator as Navigator & {
        getGamepads?: () => readonly (Gamepad | null)[];
      }
    )?.getGamepads;
    const gamepad = getGamepads?.call(globalThis.navigator)?.find((item) => item !== null);
    this.#gamepadAxes = gamepad?.axes ? [...gamepad.axes] : [];
    this.#gamepadButtons = gamepad?.buttons.map((button) => button.pressed) ?? [];
    this.raw.gamepad.axes = this.#gamepadAxes;
    this.raw.gamepad.buttons = this.#gamepadButtons;
    this.#justPressed.clear();
    this.#justReleased.clear();
    for (const name of Object.keys(this.#bindings)) {
      const current = this.pressed(name);
      const previous = this.#previousPressed.get(name) ?? false;
      if (current && !previous) this.#justPressed.add(name);
      if (!current && previous) this.#justReleased.add(name);
      this.#previousPressed.set(name, current);
    }
  }

  clear(): void {
    this.#heldKeys.clear();
    this.#pointerDown = false;
    this.#pointerButtons = 0;
    this.#pointerPosition.set(0, 0);
    this.raw.pointer.buttons = 0;
    this.raw.pointer.down = false;
    this.#previousPressed.clear();
    this.#justPressed.clear();
    this.#justReleased.clear();
  }

  dispose(): void {
    for (const [target, type, listener] of this.#listeners)
      target.removeEventListener(type, listener);
    this.#listeners = [];
    this.clear();
  }

  #isHeld(codes: readonly string[] | undefined): boolean {
    return codes?.some((code) => this.#heldKeys.has(code)) ?? false;
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#listeners.push([target, type, listener]);
  }

  #pointerEvent(event: Event, down: boolean): void {
    const pointer = event as PointerEvent;
    this.#pointerDown = down;
    this.#pointerButtons = pointer.buttons ?? 0;
    this.#pointerPosition.set(pointer.clientX ?? 0, pointer.clientY ?? 0);
    this.raw.pointer.buttons = this.#pointerButtons;
    this.raw.pointer.down = down;
    const capture = this.#pointerTarget as EventTarget & {
      releasePointerCapture?: (id: number) => void;
      setPointerCapture?: (id: number) => void;
    };
    if (down) capture.setPointerCapture?.(pointer.pointerId ?? 0);
    else capture.releasePointerCapture?.(pointer.pointerId ?? 0);
  }
}

export function input(
  bindings?: InputBindings,
  target?: EventTarget,
  pointerTarget?: EventTarget,
): InputMap {
  return new InputMap(bindings, target, pointerTarget);
}
