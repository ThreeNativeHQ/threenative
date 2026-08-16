import {
  CircleGeometry,
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
const BUTTON_RADIUS = 64;
const EDGE = 36;

interface ITouchPointer {
  readonly position: Vector2;
}

interface ITouchViewport {
  readonly height: number;
  readonly width: number;
}

type TouchControlName = "dash" | "jump" | "move";

export function touchControlPoint(size: ITouchViewport, name: TouchControlName): Vector2 {
  if (name === "move") return new Vector2(MOVE_RADIUS + EDGE, size.height - MOVE_RADIUS - EDGE);

  if (size.height > size.width) {
    const yOffset = name === "jump" ? BUTTON_RADIUS * 2 + EDGE : 0;
    return new Vector2(
      size.width - BUTTON_RADIUS - EDGE,
      size.height - BUTTON_RADIUS - EDGE - yOffset,
    );
  }

  const x =
    name === "jump" ? size.width - BUTTON_RADIUS - EDGE : size.width - BUTTON_RADIUS * 3 - EDGE;
  return new Vector2(x, size.height - BUTTON_RADIUS - EDGE);
}

export interface ITouchInput {
  readonly dashPressed: boolean;
  readonly jumpPressed: boolean;
  readonly move: Vector2;
}

/**
 * Deflection of a thumb from where that thumb landed, not from where the ring is drawn.
 *
 * A thumb does not arrive on the circle. It lands wherever the player's hand already was, and
 * measuring from a fixed centre turns that landing spot into an instant full-strength direction
 * the player never asked for — press the middle of the pad and the character bolts diagonally
 * before you have moved at all. Anchoring on touch is what every thumbstick that feels right
 * does, and it is the difference between a control that works and one that fights you.
 *
 * Exported so it can be tested without a renderer: it is pure arithmetic on two points.
 */
export function stickDeflection(anchor: Vector2, current: Vector2, radius: number): Vector2 {
  return new Vector2(
    MathUtils.clamp((current.x - anchor.x) / radius, -1, 1),
    // Screen y grows downward and the game's move.y is +up, so this axis inverts here rather
    // than in the character, which reads `move` from keyboard and touch alike.
    MathUtils.clamp((anchor.y - current.y) / radius, -1, 1),
  );
}

export class TouchControls {
  readonly root = new Group();
  #camera: PerspectiveCamera;
  #input: ITouchInput = { dashPressed: false, jumpPressed: false, move: new Vector2() };
  #wasDash = false;
  #wasJump = false;
  /** Where the current thumb landed. Undefined between touches. */
  #moveAnchor: Vector2 | undefined;
  #moveBase: Mesh;
  #moveKnob: Mesh;
  #dash: Mesh;
  #jump: Mesh;
  #idleMaterial: MeshBasicMaterial;
  #activeMaterial: MeshBasicMaterial;

  constructor(camera: PerspectiveCamera) {
    this.#camera = camera;
    this.#idleMaterial = new MeshBasicMaterial({
      color: palette.shadow,
      depthTest: false,
      depthWrite: false,
      opacity: 0.28,
      transparent: true,
    });
    this.#activeMaterial = new MeshBasicMaterial({
      color: palette.accent,
      depthTest: false,
      depthWrite: false,
      opacity: 0.58,
      transparent: true,
    });
    this.#moveBase = new Mesh(
      new RingGeometry(MOVE_RADIUS - 5, MOVE_RADIUS, 32),
      this.#idleMaterial,
    );
    this.#moveKnob = new Mesh(new CircleGeometry(28, 24), this.#activeMaterial);
    this.#dash = new Mesh(
      new RingGeometry(BUTTON_RADIUS - 5, BUTTON_RADIUS, 32),
      this.#idleMaterial,
    );
    this.#jump = new Mesh(
      new RingGeometry(BUTTON_RADIUS - 5, BUTTON_RADIUS, 32),
      this.#idleMaterial,
    );
    this.root.add(this.#moveBase, this.#moveKnob, this.#dash, this.#jump);
    this.root.renderOrder = 10_001;
    camera.add(this.root);
  }

  update(pointers: ReadonlyMap<number, ITouchPointer>, size: ITouchViewport): ITouchInput {
    const jumpCenter = touchControlPoint(size, "jump");
    const dashCenter = touchControlPoint(size, "dash");
    const jump = this.#at(pointers, jumpCenter, BUTTON_RADIUS);
    const dash = this.#at(pointers, dashCenter, BUTTON_RADIUS);
    const left = [...pointers.values()].find((pointer) =>
      this.#isMovementPointer(pointer, size, dashCenter, jumpCenter),
    );
    const resting = touchControlPoint(size, "move");
    const move = this.#input.move;
    if (left === undefined) {
      // Thumb lifted: forget where it was, so the next touch anchors fresh.
      this.#moveAnchor = undefined;
      move.set(0, 0);
    } else {
      this.#moveAnchor ??= left.position.clone();
      move.copy(stickDeflection(this.#moveAnchor, left.position, MOVE_RADIUS));
    }
    // The ring follows the thumb to its anchor, so the player can see where the stick went
    // instead of watching a knob move against a circle their thumb is nowhere near.
    const center = this.#moveAnchor ?? resting;
    this.#moveBase.position.set(center.x, center.y, 0);
    this.#moveKnob.position.set(
      center.x + move.x * MOVE_RADIUS,
      center.y - move.y * MOVE_RADIUS,
      0,
    );
    this.#jump.material = jump ? this.#activeMaterial : this.#idleMaterial;
    this.#dash.material = dash ? this.#activeMaterial : this.#idleMaterial;
    this.#input = {
      dashPressed: dash && !this.#wasDash,
      jumpPressed: jump && !this.#wasJump,
      move,
    };
    this.#wasDash = dash;
    this.#wasJump = jump;
    this.#layout(size);
    return this.#input;
  }

  debug(): Record<string, unknown> {
    return { dash: this.#wasDash, jump: this.#wasJump, move: this.#input.move.toArray() };
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const child of this.root.children) {
      if (child instanceof Mesh) child.geometry.dispose();
    }
    this.#idleMaterial.dispose();
    this.#activeMaterial.dispose();
  }

  #layout(size: ITouchViewport): void {
    const worldHeight = 2 * Math.tan(MathUtils.degToRad(this.#camera.fov / 2));
    const pixels = worldHeight / Math.max(1, size.height);
    const worldWidth = size.width * pixels;
    this.root.position.set(-worldWidth / 2, worldHeight / 2, -1);
    this.root.scale.set(pixels, -pixels, 1);
    // The anchor wins while a thumb is down; this only re-homes the ring once it lifts.
    const move = this.#moveAnchor ?? touchControlPoint(size, "move");
    const dash = touchControlPoint(size, "dash");
    const jump = touchControlPoint(size, "jump");
    this.#moveBase.position.set(move.x, move.y, 0);
    this.#dash.position.set(dash.x, dash.y, 0);
    this.#jump.position.set(jump.x, jump.y, 0);
  }

  #isMovementPointer(
    pointer: ITouchPointer,
    size: ITouchViewport,
    dashCenter: Vector2,
    jumpCenter: Vector2,
  ): boolean {
    if (pointer.position.x >= size.width * 0.5 || pointer.position.y <= size.height * 0.5)
      return false;
    if (size.height <= size.width) return true;
    const radiusSquared = BUTTON_RADIUS * BUTTON_RADIUS;
    return (
      pointer.position.distanceToSquared(dashCenter) > radiusSquared &&
      pointer.position.distanceToSquared(jumpCenter) > radiusSquared
    );
  }

  #at(pointers: ReadonlyMap<number, ITouchPointer>, center: Vector2, radius: number): boolean {
    const radiusSquared = radius * radius;
    return [...pointers.values()].some(
      (pointer) => pointer.position.distanceToSquared(center) <= radiusSquared,
    );
  }
}
