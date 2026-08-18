import { Vector2 } from "three";

/**
 * One action, read either as a button through `pressed`/`justPressed` or as a 2D axis through
 * `vector`. Which one you get depends on the fields you fill in, and mixing the two is what
 * makes bindings confusing to read:
 *
 * ```ts
 * jump: { keys: ["Space"], buttons: [0] }                 // a button: key or *gamepad* button 0
 * fire: { keys: ["Space"], mouseButtons: [0] }            // a button: key or *left mouse*
 * move: { up: ["KeyW"], down: ["KeyS"], left: [...], right: [...] }  // an axis
 * ```
 *
 * **`buttons` is the gamepad, `mouseButtons` is the mouse.** They are separate devices and
 * `buttons: [0]` on a machine with no gamepad plugged in silently never fires.
 *
 * `up`/`down`/`left`/`right` are **directions of an axis**, not "the keys that press this".
 * They are named after the vector they build, so `pressed("move")` is true whenever any
 * direction is held — including `ArrowDown`. For a button, use `keys`.
 */
export interface IInputAction {
  /** **Gamepad** button indices that press this action. For the mouse, see `mouseButtons`. */
  readonly buttons?: readonly number[];
  /**
   * **Mouse** button indices that press this action, numbered as `MouseEvent.button`:
   * `0` left, `1` middle, `2` right. Binding `2` also suppresses the browser context menu on
   * the pointer target, because a right-click binding is unusable while the menu eats it.
   */
  readonly mouseButtons?: readonly number[];
  /**
   * Keyboard codes that press this action. Use this for a button — `jump`, `restart`, `fire`.
   * A key listed here never contributes to `vector`.
   */
  readonly keys?: readonly string[];
  /** The **−y** direction of `vector(name)`. Not "the keys that press this action" — see `keys`. */
  readonly down?: readonly string[];
  /** The −x direction of `vector(name)`. */
  readonly left?: readonly string[];
  /** Any active pointer or touch presses this action. */
  readonly pointer?: boolean;
  /** Add raw mouse movement since the last input tick to `vector(name)`. */
  readonly pointerRelative?: boolean;
  /** The +x direction of `vector(name)`. */
  readonly right?: readonly string[];
  /** The +y direction of `vector(name)`. */
  readonly up?: readonly string[];
}

export type InputBindings = Record<string, IInputAction>;

/**
 * What the browser context menu does over the game surface. `"suppress"` is the default: a
 * right-click binding cannot work while the menu opens on the same press, and a context menu
 * over a game canvas is almost never what anyone wants. `"allow"` restores the browser default.
 */
export type ContextMenuPolicy = "allow" | "suppress";

/**
 * `MouseEvent.button` (0 left, 1 middle, 2 right) to the `PointerEvent.buttons` bit that is set
 * while it is held (1 left, 4 middle, 2 right). The two numbering schemes disagree for the
 * middle and right buttons, which is why this is a table rather than a shift.
 */
const MOUSE_BUTTON_BITS: readonly number[] = [1, 4, 2, 8, 16];

function mouseButtonMask(button: number): number {
  return MOUSE_BUTTON_BITS[button] ?? 0;
}

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
    captured: boolean;
    down: boolean;
    readonly position: Vector2;
    /** Accumulated relative mouse motion since the last `tick`, in canvas pixels. */
    readonly relative: Vector2;
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

type PointerLockTarget = EventTarget & {
  exitPointerLock?: () => void | Promise<void>;
  requestPointerLock?: () => void | Promise<void>;
};

type PointerLockDocument = EventTarget & {
  exitPointerLock?: () => void | Promise<void>;
  pointerLockElement?: unknown;
};

function pointerLockDocument(): PointerLockDocument | undefined {
  const candidate = (globalThis as typeof globalThis & { document?: unknown }).document;
  if (candidate === null || typeof candidate !== "object") return undefined;
  if (typeof (candidate as { addEventListener?: unknown }).addEventListener !== "function") {
    return undefined;
  }
  return candidate as PointerLockDocument;
}

const browserGamepads: InputPlatformSource = () =>
  (globalThis.navigator as Navigator | undefined)?.getGamepads?.() ?? [];

export class InputMap {
  readonly raw: IRawInputState;
  #bindings: InputBindings;
  #target: EventTarget;
  #heldKeys = new Set<string>();
  #pointerPosition = new Vector2();
  #pointerRelative = new Vector2();
  #relativeSample = new Vector2();
  #pointerButtons = 0;
  #pointers = new Map<number, IRawInputPointer>();
  #gamepadAxes: number[] = [];
  #gamepadButtons: boolean[] = [];
  #previousPressed = new Map<string, boolean>();
  #justPressed = new Set<string>();
  #justReleased = new Set<string>();
  /**
   * Presses seen since the last `tick`, kept even if the input was already released.
   *
   * Device state alone is sampled once a frame, so a press that starts and ends between two
   * ticks is simply not there when the frame looks — and a mouse click is normally shorter than
   * a frame at 60Hz. Without this latch a quick click does nothing at all, intermittently,
   * which reads as a broken game rather than a dropped edge.
   */
  #latchedKeys = new Set<string>();
  #latchedPointerButtons = 0;
  #latchedPointer = false;
  #pointerTarget: EventTarget;
  #source: InputPlatformSource;
  #listeners: Array<[EventTarget, string, EventListener]> = [];

  constructor(
    bindings: InputBindings = DEFAULT_BINDINGS,
    target: EventTarget = globalThis,
    pointerTarget: EventTarget = target,
    source: InputPlatformSource = browserGamepads,
    contextMenu: ContextMenuPolicy = "suppress",
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
        captured: false,
        down: false,
        position: this.#pointerPosition,
        relative: this.#pointerRelative,
      },
      pointers: this.#pointers,
    };
    this.#listen(this.#target, "keydown", (event) => {
      const code = eventCode(event);
      if (code !== undefined) {
        this.#heldKeys.add(code);
        this.#latchedKeys.add(code);
      }
    });
    this.#listen(this.#target, "keyup", (event) => {
      const code = eventCode(event);
      if (code !== undefined) this.#heldKeys.delete(code);
    });
    this.#listen(this.#target, "mousemove", (event) => this.#mouseEvent(event));
    this.#listen(this.#pointerTarget, "pointerdown", (event) => this.#pointerEvent(event, true));
    this.#listen(this.#pointerTarget, "pointermove", (event) => this.#pointerEvent(event));
    this.#listen(this.#pointerTarget, "pointerup", (event) => this.#pointerEvent(event, false));
    this.#listen(this.#pointerTarget, "pointercancel", (event) => this.#pointerEvent(event, false));
    this.#listen(this.#target, "blur", () => this.clear());
    // The browser context menu is suppressed on the game surface by default. A right-click
    // binding is simply unusable while the menu eats the press, and no game yet built here has
    // wanted the menu over its own canvas. `contextMenu: "allow"` restores the browser default
    // for the rare case that does.
    if (contextMenu !== "allow") {
      this.#listen(this.#pointerTarget, "contextmenu", (event) => event.preventDefault());
    }
    const lockDocument = pointerLockDocument();
    const lockTargets = new Set<EventTarget>([this.#target, this.#pointerTarget]);
    if (lockDocument !== undefined) lockTargets.add(lockDocument);
    for (const target of lockTargets) {
      this.#listen(target, "pointerlockchange", () => this.#syncCaptured());
    }
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
    if (binding.pointerRelative === true) vector.add(this.#relativeSample);
    return binding.pointerRelative === true ? vector : vector.clampLength(0, 1);
  }

  /** Request pointer capture. Call this from a user gesture on the game surface. */
  captureMouse(): void {
    if (this.raw.pointer.captured) return;
    const target = this.#pointerTarget as PointerLockTarget;
    if (typeof target.requestPointerLock !== "function") {
      throw new Error("Pointer capture is unavailable on the input target.");
    }
    const result = target.requestPointerLock();
    if (result === undefined) {
      this.#syncCaptured(true);
      return;
    }
    void result.then(
      () => this.#syncCaptured(true),
      (error: unknown) => {
        this.raw.pointer.captured = false;
        throw error;
      },
    );
  }

  /** Release pointer capture. A browser refusal remains an unhandled rejection. */
  releaseMouse(): void {
    const document = pointerLockDocument();
    const target = (document ?? this.#pointerTarget) as PointerLockTarget;
    const exit = target.exitPointerLock;
    if (typeof exit !== "function") {
      throw new Error("Pointer capture release is unavailable on the input target.");
    }
    const result = exit.call(target);
    if (result === undefined) {
      this.#syncCaptured(false);
      return;
    }
    void result.then(
      () => this.#syncCaptured(false),
      (error: unknown) => {
        throw error;
      },
    );
  }

  pressed(name: string): boolean {
    const binding = this.#bindings[name];
    if (binding === undefined) return false;
    return (
      this.#isHeld(binding.keys) ||
      this.#isHeld(binding.down) ||
      this.#isHeld(binding.left) ||
      this.#isHeld(binding.right) ||
      this.#isHeld(binding.up) ||
      (binding.pointer === true && this.#pointers.size > 0) ||
      (binding.mouseButtons?.some(
        (button) => (this.#pointerButtons & mouseButtonMask(button)) !== 0,
      ) ??
        false) ||
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
    this.#relativeSample.copy(this.#pointerRelative);
    this.#pointerRelative.set(0, 0);
    const gamepad = this.#source().find((item) => item !== null);
    this.#gamepadAxes = gamepad?.axes ? Array.from(gamepad.axes) : [];
    this.#gamepadButtons = gamepad?.buttons.map((button) => button.pressed) ?? [];
    this.raw.gamepad.axes = this.#gamepadAxes;
    this.raw.gamepad.buttons = this.#gamepadButtons;
    this.#justPressed.clear();
    this.#justReleased.clear();
    for (const name of Object.keys(this.#bindings)) {
      // A press that came and went inside this frame still counts as a press. `pressed()` stays
      // instantaneous — it answers "is it down right now" — while the edge is latched, so a tap
      // reports justPressed on this frame and justReleased on the next one.
      const current = this.pressed(name) || this.#latchedPressed(name);
      const previous = this.#previousPressed.get(name) ?? false;
      if (current && !previous) this.#justPressed.add(name);
      if (!current && previous) this.#justReleased.add(name);
      this.#previousPressed.set(name, current);
    }
    this.#latchedKeys.clear();
    this.#latchedPointerButtons = 0;
    this.#latchedPointer = false;
  }

  clear(): void {
    this.#heldKeys.clear();
    this.#latchedKeys.clear();
    this.#latchedPointerButtons = 0;
    this.#latchedPointer = false;
    this.#pointers.clear();
    this.#pointerButtons = 0;
    this.#pointerPosition.set(0, 0);
    this.#pointerRelative.set(0, 0);
    this.#relativeSample.set(0, 0);
    this.raw.pointer.buttons = 0;
    this.raw.pointer.down = false;
    this.#previousPressed.clear();
    this.#justPressed.clear();
    this.#justReleased.clear();
  }

  dispose(): void {
    if (this.raw.pointer.captured) {
      try {
        this.releaseMouse();
      } catch {
        this.raw.pointer.captured = false;
      }
    }
    for (const [target, type, listener] of this.#listeners)
      target.removeEventListener(type, listener);
    this.#listeners = [];
    this.clear();
  }

  /** Was this action pressed at any point since the last tick, even if already released? */
  #latchedPressed(name: string): boolean {
    const binding = this.#bindings[name];
    if (binding === undefined) return false;
    const latched = (codes: readonly string[] | undefined): boolean =>
      codes?.some((code) => this.#latchedKeys.has(code)) ?? false;
    return (
      latched(binding.keys) ||
      latched(binding.down) ||
      latched(binding.left) ||
      latched(binding.right) ||
      latched(binding.up) ||
      (binding.pointer === true && this.#latchedPointer) ||
      (binding.mouseButtons?.some(
        (button) => (this.#latchedPointerButtons & mouseButtonMask(button)) !== 0,
      ) ??
        false)
    );
  }

  #isHeld(codes: readonly string[] | undefined): boolean {
    return codes?.some((code) => this.#heldKeys.has(code)) ?? false;
  }

  #listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    this.#listeners.push([target, type, listener]);
  }

  #mouseEvent(event: Event): void {
    const mouse = event as MouseEvent;
    if (Number.isFinite(mouse.movementX)) this.#pointerRelative.x += mouse.movementX;
    if (Number.isFinite(mouse.movementY)) this.#pointerRelative.y += mouse.movementY;
  }

  #syncCaptured(fallback?: boolean): void {
    const document = pointerLockDocument();
    if (document?.pointerLockElement !== undefined) {
      this.raw.pointer.captured = document.pointerLockElement === this.#pointerTarget;
    } else if (fallback !== undefined) {
      this.raw.pointer.captured = fallback;
    }
  }

  #pointerEvent(event: Event, down?: boolean): void {
    const pointer = event as PointerEvent;
    const id = pointer.pointerId ?? 0;
    const buttons = pointer.buttons ?? 0;
    const x = pointer.clientX ?? 0;
    const y = pointer.clientY ?? 0;
    if (buttons !== 0) this.#latchedPointerButtons |= buttons;
    if (down === true) this.#latchedPointer = true;
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
      try {
        if (down === true) capture.setPointerCapture?.(id);
        if (down === false) capture.releasePointerCapture?.(id);
      } catch (error) {
        // A pointer-lock transition can make a trusted event temporarily uncapturable.
        if (!(error instanceof Error && error.name === "InvalidStateError")) throw error;
      }
    }
  }
}
