import { Vector2 } from "three";

export interface IInputAction {
  readonly buttons?: readonly number[];
  readonly down?: readonly string[];
  readonly left?: readonly string[];
  readonly pointer?: boolean;
  readonly right?: readonly string[];
  readonly up?: readonly string[];
}

export type InputBindings = Record<string, IInputAction>;

export interface IInputGamepad {
  readonly axes: ArrayLike<number>;
  readonly buttons: readonly { readonly pressed: boolean }[];
}

export type InputPlatformSource = () => readonly (IInputGamepad | null)[];

export interface IRawInputPointer {
  readonly id: number;
  buttons: number;
  readonly position: Vector2;
}

export interface IRawInputState {
  readonly keys: ReadonlySet<string>;
  readonly pointer: {
    buttons: number;
    down: boolean;
    readonly position: Vector2;
  };
  readonly pointers: ReadonlyMap<number, IRawInputPointer>;
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

const browserGamepads: InputPlatformSource = () =>
  (globalThis.navigator as Navigator | undefined)?.getGamepads?.() ?? [];

export class InputMap {
  readonly raw: IRawInputState;
  #bindings: InputBindings;
  #target: EventTarget;
  #heldKeys = new Set<string>();
  #pointerPosition = new Vector2();
  #pointerButtons = 0;
  #pointers = new Map<number, IRawInputPointer>();
  #gamepadAxes: number[] = [];
  #gamepadButtons: boolean[] = [];
  #previousPressed = new Map<string, boolean>();
  #justPressed = new Set<string>();
  #justReleased = new Set<string>();
  #pointerTarget: EventTarget;
  #source: InputPlatformSource;
  #listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    bindings: InputBindings = DEFAULT_BINDINGS,
    target: EventTarget = globalThis,
    pointerTarget: EventTarget = target,
    source: InputPlatformSource = browserGamepads,
  ) {
    this.#bindings = { ...DEFAULT_BINDINGS, ...bindings };
    this.#target = target;
    this.#pointerTarget = pointerTarget;
    this.#source = source;
    this.raw = {
      gamepad: { axes: this.#gamepadAxes, buttons: this.#gamepadButtons },
      keys: this.#heldKeys,
      pointer: {
        buttons: this.#pointerButtons,
        down: false,
        position: this.#pointerPosition,
      },
      pointers: this.#pointers,
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
    this.#listen(this.#pointerTarget, "pointermove", (event) => this.#pointerEvent(event));
    this.#listen(this.#pointerTarget, "pointerup", (event) => this.#pointerEvent(event, false));
    this.#listen(this.#pointerTarget, "pointercancel", (event) => this.#pointerEvent(event, false));
    this.#listen(this.#target, "blur", () => this.clear());
  }

  /**
   * Returns a 2D action vector where +y is up. On a conventional XZ ground plane whose
   * forward direction is -z, map `vector.y` to `-z`. This differs from Godot's
   * `Input.get_vector`, where up is -y.
   */
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
      (binding.pointer === true && this.#pointers.size > 0) ||
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
    const gamepad = this.#source().find((item) => item !== null);
    this.#gamepadAxes = gamepad?.axes ? Array.from(gamepad.axes) : [];
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
    this.#pointers.clear();
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

  #pointerEvent(event: Event, down?: boolean): void {
    const pointer = event as PointerEvent;
    const id = pointer.pointerId ?? 0;
    const buttons = pointer.buttons ?? 0;
    const x = pointer.clientX ?? 0;
    const y = pointer.clientY ?? 0;
    const tracked = this.#pointers.get(id);
    if (down === true) {
      if (tracked === undefined) {
        this.#pointers.set(id, { buttons, id, position: new Vector2(x, y) });
      } else {
        tracked.buttons = buttons;
        tracked.position.set(x, y);
      }
    } else if (down === false) {
      this.#pointers.delete(id);
    } else if (tracked !== undefined) {
      tracked.buttons = buttons;
      tracked.position.set(x, y);
    }
    const primary = this.#pointers.values().next().value as IRawInputPointer | undefined;
    if (primary !== undefined) {
      this.#pointerButtons = primary.buttons;
      this.#pointerPosition.copy(primary.position);
    } else if (down !== false || tracked !== undefined) {
      this.#pointerButtons = buttons;
      this.#pointerPosition.set(x, y);
    }
    this.raw.pointer.buttons = this.#pointerButtons;
    this.raw.pointer.down = primary !== undefined;
    const capture = this.#pointerTarget as EventTarget & {
      releasePointerCapture?: (id: number) => void;
      setPointerCapture?: (id: number) => void;
    };
    // Browser conformance injects untrusted PointerEvents with dispatchEvent(). Chromium
    // rejects pointer capture for those events because no physical pointer is active.
    // Real browser input remains captured; native hosts may omit isTrusted and keep their stub.
    if (pointer.isTrusted !== false) {
      if (down === true) capture.setPointerCapture?.(id);
      if (down === false) capture.releasePointerCapture?.(id);
    }
  }
}
