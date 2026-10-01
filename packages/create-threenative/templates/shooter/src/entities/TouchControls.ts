import type { ICtx } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { MathUtils } from "three";
import type { GameState } from "../state.js";

type GameCtx = ICtx<GameState, IPhysicsContext>;

/**
 * Thumb controls for playing on a phone, read straight off the engine's multitouch map.
 *
 * ## Why this is game code and not a framework widget
 *
 * `ctx.input.raw.pointers` is a `ReadonlyMap<number, IRawInputPointer>` — every active finger with
 * its id and canvas position. That is the whole platform surface this needs, so the layout, the
 * dead zone, the button placement and the look sensitivity are all decisions this game makes, and
 * nothing here touches `document`, `window` or a touch event. It runs on the native target for the
 * same reason the rest of the scene does.
 *
 * ## The layout, and why it is fixed rather than clever
 *
 * Left thumb drives a floating stick: wherever the finger lands in the left band becomes the
 * origin, and the drag from it is the move vector. A floating origin is the difference between a
 * stick you can use without looking and one you keep missing — a fixed on-screen circle demands
 * the player's eyes, and their eyes are on the fight.
 *
 * Right thumb looks, except inside the action buttons. Look is a *delta* per tick, not a position,
 * so it behaves like a trackpad and never snaps the view when a finger is re-planted.
 *
 * ## Pointer lock does not exist here
 *
 * `Look.consume` refuses to turn the view unless `pointer.captured` is true, which is correct for
 * a mouse and impossible on a touch screen — there is no pointer lock to earn. Touch look is
 * therefore delivered as its own delta that the player adds on top, rather than by pretending a
 * lock was granted.
 */

/** Radius, in CSS pixels, a finger must travel before the stick reads full tilt. */
const STICK_RANGE = 74;
/** Slack around the origin, so a resting thumb does not creep. */
const STICK_DEAD_ZONE = 9;
/** Touch look is a raw pixel delta; this scales it to feel like the mouse without a lock. */
const LOOK_SCALE = 1.35;
/**
 * How far forward the stick has to go before it is a sprint, and how far back before it is not.
 *
 * Sprint is a *gesture*, not a seventh button. The right thumb already carries fire, aim, reload
 * and crouch, and the screen a phone has left after those is the screen the player is trying to
 * shoot into — a fifth circle would cost more of the fight than it is worth. Pushing the stick to
 * the stop is what every phone shooter means by "run", and the left thumb is otherwise idle.
 *
 * The two thresholds are a Schmitt trigger. A single one at 0.9 puts the sprint flag on the same
 * knife edge the thumb rests on, so a player holding full forward flickers between walk and sprint
 * several times a second — audible in the footstep cadence and visible in the weapon sway.
 */
const SPRINT_ENGAGE = 0.92;
const SPRINT_RELEASE = 0.78;
/** How straight ahead the push has to be. A diagonal is a strafe, and nobody sprints sideways. */
const SPRINT_FORWARD_DOT = 0.72;

/** A circular on-screen button, positioned from the bottom-right in CSS pixels. */
type Button = {
  readonly action: "fire" | "aim" | "reload" | "crouch";
  /** Offset from the right edge and the bottom edge, to the button's centre. */
  readonly right: number;
  readonly bottom: number;
  readonly radius: number;
};

/**
 * Thumb-reachable and non-overlapping at 411 CSS px wide, which is a Pixel 8 in portrait — the
 * narrowest surface this has to work on. Fire is the largest and lowest because it is pressed
 * most and missed worst.
 */
const BUTTONS: readonly Button[] = [
  { action: "fire", right: 86, bottom: 104, radius: 58 },
  { action: "aim", right: 178, bottom: 196, radius: 38 },
  { action: "reload", right: 74, bottom: 216, radius: 34 },
  { action: "crouch", right: 196, bottom: 92, radius: 34 },
];

type Role =
  | { kind: "stick"; originX: number; originY: number; x: number; y: number }
  | { kind: "look"; lastX: number; lastY: number }
  | { kind: "button"; action: Button["action"] };

/** What one tick of touch input asked for. Consumed by the player, drawn by the HUD. */
export type TouchFrame = {
  readonly moveX: number;
  readonly moveY: number;
  readonly lookX: number;
  readonly lookY: number;
  readonly fire: boolean;
  readonly aim: boolean;
  readonly reload: boolean;
  readonly crouch: boolean;
  readonly sprint: boolean;
};

const IDLE: TouchFrame = {
  moveX: 0,
  moveY: 0,
  lookX: 0,
  lookY: 0,
  fire: false,
  aim: false,
  reload: false,
  crouch: false,
  sprint: false,
};

export class TouchControls {
  #roles = new Map<number, Role>();
  #frame: TouchFrame = IDLE;
  /** True once any finger has touched the surface, so the HUD only appears on a touch device. */
  #engaged = false;
  /** Rising-edge latch: reload should fire once per press, not once per tick held. */
  #reloadWasDown = false;
  /** Hysteresis state for the stick-push sprint: what it decided last tick. */
  #sprinting = false;

  get frame(): TouchFrame {
    return this.#frame;
  }

  get engaged(): boolean {
    return this.#engaged;
  }

  /** Where the left stick is being drawn from and to, in CSS pixels, or undefined when idle. */
  get stick(): { originX: number; originY: number; x: number; y: number } | undefined {
    for (const role of this.#roles.values()) {
      if (role.kind === "stick") {
        return { originX: role.originX, originY: role.originY, x: role.x, y: role.y };
      }
    }
    return undefined;
  }

  /** The button layout, so the HUD draws exactly the circles this class tests against. */
  static get buttons(): readonly Button[] {
    return BUTTONS;
  }

  /** Which actions are held this tick, for the HUD's pressed state. */
  heldActions(): ReadonlySet<Button["action"]> {
    const held = new Set<Button["action"]>();
    for (const role of this.#roles.values()) if (role.kind === "button") held.add(role.action);
    return held;
  }

  #buttonAt(x: number, y: number, width: number, height: number): Button | undefined {
    for (const button of BUTTONS) {
      const cx = width - button.right;
      const cy = height - button.bottom;
      if (Math.hypot(x - cx, y - cy) <= button.radius) return button;
    }
    return undefined;
  }

  update(ctx: GameCtx): TouchFrame {
    const pointers = ctx.input.raw.pointers;
    const { width, height } = ctx.viewport.size;

    // Fingers that left the glass give up their role, or a lifted thumb keeps steering.
    for (const id of [...this.#roles.keys()]) {
      if (!pointers.has(id)) this.#roles.delete(id);
    }

    let lookX = 0;
    let lookY = 0;

    // One pass. Look is a delta against the previous tick, so it must be read *before* the
    // stored sample is advanced — computing it afterwards reads zero, every tick, forever.
    for (const [id, pointer] of pointers) {
      const x = pointer.position.x;
      const y = pointer.position.y;
      const existing = this.#roles.get(id);
      if (existing === undefined) {
        this.#engaged = true;
        const button = this.#buttonAt(x, y, width, height);
        if (button !== undefined) {
          this.#roles.set(id, { kind: "button", action: button.action });
        } else if (x < width * 0.45) {
          // Floating origin: the stick is wherever the thumb landed.
          this.#roles.set(id, { kind: "stick", originX: x, originY: y, x, y });
        } else {
          this.#roles.set(id, { kind: "look", lastX: x, lastY: y });
        }
        continue;
      }
      if (existing.kind === "stick") {
        existing.x = x;
        existing.y = y;
      } else if (existing.kind === "look") {
        lookX += (x - existing.lastX) * LOOK_SCALE;
        lookY += (y - existing.lastY) * LOOK_SCALE;
        existing.lastX = x;
        existing.lastY = y;
      }
    }

    let moveX = 0;
    let moveY = 0;
    let stickPush = 0;
    let fire = false;
    let aim = false;
    let reloadDown = false;
    let crouch = false;

    for (const role of this.#roles.values()) {
      if (role.kind === "stick") {
        const dx = role.x - role.originX;
        // Screen y grows downward; the move action's y is +up, so this is negated.
        const dy = -(role.y - role.originY);
        const distance = Math.hypot(dx, dy);
        if (distance > STICK_DEAD_ZONE) {
          const strength = Math.min(1, (distance - STICK_DEAD_ZONE) / STICK_RANGE);
          moveX = (dx / distance) * strength;
          moveY = (dy / distance) * strength;
          // Forward component only: the push has to be both far and roughly straight ahead.
          stickPush = dy / distance >= SPRINT_FORWARD_DOT ? strength : 0;
        }
      } else if (role.kind === "button") {
        if (role.action === "fire") fire = true;
        if (role.action === "aim") aim = true;
        if (role.action === "reload") reloadDown = true;
        if (role.action === "crouch") crouch = true;
      }
    }

    // Rising edge: a held reload button should load once, not once per tick.
    const reload = reloadDown && !this.#reloadWasDown;
    this.#reloadWasDown = reloadDown;

    // Aiming and sprinting are the same request in opposite directions, and the player's own
    // movement code already refuses to sprint while aiming; declining here as well keeps the
    // reported frame honest about what the thumbs actually asked for.
    this.#sprinting = aim
      ? false
      : this.#sprinting
        ? stickPush >= SPRINT_RELEASE
        : stickPush >= SPRINT_ENGAGE;

    this.#frame = {
      moveX: MathUtils.clamp(moveX, -1, 1),
      moveY: MathUtils.clamp(moveY, -1, 1),
      lookX,
      lookY,
      fire,
      aim,
      reload,
      crouch,
      sprint: this.#sprinting,
    };
    return this.#frame;
  }

  /** Registered as an entity so a scenario can assert a thumb actually drove the player. */
  debug(): {
    engaged: number;
    activePointers: number;
    moveX: number;
    moveY: number;
    firing: number;
    sprinting: number;
  } {
    return {
      engaged: this.#engaged ? 1 : 0,
      activePointers: this.#roles.size,
      moveX: Number(this.#frame.moveX.toFixed(3)),
      moveY: Number(this.#frame.moveY.toFixed(3)),
      firing: this.#frame.fire ? 1 : 0,
      sprinting: this.#frame.sprint ? 1 : 0,
    };
  }
}
