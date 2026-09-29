import {
  CircleGeometry,
  type ColorRepresentation,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  RingGeometry,
  Vector2,
} from "three";
import { palette } from "./palette.js";

const MOVE_RADIUS = 72;
const BUTTON_RADIUS = 46;
const EDGE = 30;

export interface ITouchPointer {
  readonly position: Vector2;
}

export interface ITouchViewport {
  readonly height: number;
  readonly width: number;
}

export interface ITouchInput {
  readonly attackPressed: boolean;
  readonly interactPressed: boolean;
  /** Pixels the camera-drag finger travelled since the last frame. */
  readonly look: Vector2;
  readonly move: Vector2;
  readonly rollPressed: boolean;
}

type ButtonName = "attack" | "interact" | "roll";
const BUTTONS: readonly ButtonName[] = ["attack", "roll", "interact"];

function overlay(color: ColorRepresentation, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, depthTest: false, depthWrite: false, opacity, transparent: true });
}

/** A left stick, three right-hand buttons (sword, roll, talk), and a drag anywhere else to orbit. */
export class TouchControls {
  readonly root = new Group();
  readonly object = this.root;
  #camera: PerspectiveCamera;
  #input = { attackPressed: false, interactPressed: false, look: new Vector2(), move: new Vector2(), rollPressed: false };
  #was: Record<ButtonName, boolean> = { attack: false, interact: false, roll: false };
  #centres: Record<ButtonName, Vector2> = { attack: new Vector2(), interact: new Vector2(), roll: new Vector2() };
  #moveAnchor = new Vector2();
  #resting = new Vector2();
  #lookAt = new Vector2();
  #lookId = -1;
  #hasAnchor = false;
  #lastWidth = -1;
  #lastHeight = -1;
  #base: Mesh;
  #knob: Mesh;
  #buttons: Record<ButtonName, Mesh>;
  #idle = overlay(palette.stone, 0.32);
  #active = overlay(palette.accent, 0.6);

  constructor(camera: PerspectiveCamera) {
    this.#camera = camera;
    this.#base = new Mesh(new RingGeometry(MOVE_RADIUS - 5, MOVE_RADIUS, 32), this.#idle);
    this.#knob = new Mesh(new CircleGeometry(28, 24), this.#active);
    this.#buttons = {
      attack: new Mesh(new RingGeometry(BUTTON_RADIUS - 5, BUTTON_RADIUS, 32), this.#idle),
      interact: new Mesh(new RingGeometry(BUTTON_RADIUS - 5, BUTTON_RADIUS, 32), this.#idle),
      roll: new Mesh(new RingGeometry(BUTTON_RADIUS - 5, BUTTON_RADIUS, 32), this.#idle),
    };
    this.root.add(this.#base, this.#knob, ...BUTTONS.map((name) => this.#buttons[name]));
    this.root.renderOrder = 10_001;
    camera.add(this.root);
  }

  update(pointers: ReadonlyMap<number, ITouchPointer>, size: ITouchViewport): ITouchInput {
    if (size.width !== this.#lastWidth || size.height !== this.#lastHeight) this.#layoutPoints(size);
    const pressed = {} as Record<ButtonName, boolean>;
    for (const name of BUTTONS) pressed[name] = this.#within(pointers, this.#centres[name], BUTTON_RADIUS);
    let movement: ITouchPointer | undefined;
    let looking: [number, ITouchPointer] | undefined;
    for (const [id, pointer] of pointers) {
      if (pointer.position.x < size.width * 0.4) movement ??= pointer;
      else if (!BUTTONS.some((name) => pointer.position.distanceTo(this.#centres[name]) <= BUTTON_RADIUS * 1.4)) {
        if (id === this.#lookId || looking === undefined) looking = [id, pointer];
      }
    }
    if (movement === undefined) {
      this.#hasAnchor = false;
      this.#input.move.set(0, 0);
    } else {
      if (!this.#hasAnchor) {
        this.#moveAnchor.copy(movement.position);
        this.#hasAnchor = true;
      }
      this.#input.move.set(
        MathUtils.clamp((movement.position.x - this.#moveAnchor.x) / MOVE_RADIUS, -1, 1),
        MathUtils.clamp((this.#moveAnchor.y - movement.position.y) / MOVE_RADIUS, -1, 1),
      );
    }
    this.#input.look.set(0, 0);
    if (looking === undefined) this.#lookId = -1;
    else {
      if (looking[0] === this.#lookId) this.#input.look.copy(looking[1].position).sub(this.#lookAt);
      this.#lookId = looking[0];
      this.#lookAt.copy(looking[1].position);
    }
    const centre = this.#hasAnchor ? this.#moveAnchor : this.#resting;
    this.#knob.position.set(centre.x + this.#input.move.x * MOVE_RADIUS, centre.y - this.#input.move.y * MOVE_RADIUS, 0);
    this.#input.attackPressed = pressed.attack && !this.#was.attack;
    this.#input.rollPressed = pressed.roll && !this.#was.roll;
    this.#input.interactPressed = pressed.interact && !this.#was.interact;
    for (const name of BUTTONS) {
      this.#buttons[name].material = pressed[name] ? this.#active : this.#idle;
      this.#was[name] = pressed[name];
    }
    this.#place(size);
    return this.#input;
  }

  debug(): Record<string, unknown> {
    return { attack: this.#was.attack, interact: this.#was.interact, move: this.#input.move.toArray(), roll: this.#was.roll };
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const child of this.root.children) if (child instanceof Mesh) child.geometry.dispose();
    this.#idle.dispose();
    this.#active.dispose();
  }

  #layoutPoints(size: ITouchViewport): void {
    this.#lastWidth = size.width;
    this.#lastHeight = size.height;
    this.#resting.set(MOVE_RADIUS + EDGE, size.height - MOVE_RADIUS - EDGE);
    const right = size.width - BUTTON_RADIUS - EDGE;
    const bottom = size.height - BUTTON_RADIUS - EDGE;
    this.#centres.attack.set(right, bottom);
    this.#centres.roll.set(right - BUTTON_RADIUS * 2 - 14, bottom + 6);
    this.#centres.interact.set(right - 4, bottom - BUTTON_RADIUS * 2 - 14);
  }

  #place(size: ITouchViewport): void {
    const worldHeight = 2 * Math.tan(MathUtils.degToRad(this.#camera.fov / 2));
    const pixels = worldHeight / Math.max(1, size.height);
    this.root.position.set(-(size.width * pixels) / 2, worldHeight / 2, -1);
    this.root.scale.set(pixels, -pixels, 1);
    const anchor = this.#hasAnchor ? this.#moveAnchor : this.#resting;
    this.#base.position.set(anchor.x, anchor.y, 0);
    for (const name of BUTTONS) this.#buttons[name].position.set(this.#centres[name].x, this.#centres[name].y, 0);
  }

  #within(pointers: ReadonlyMap<number, ITouchPointer>, centre: Vector2, radius: number): boolean {
    for (const pointer of pointers.values()) if (pointer.position.distanceToSquared(centre) <= radius * radius) return true;
    return false;
  }
}
