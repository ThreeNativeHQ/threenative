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
import {
  BUTTON_RADIUS,
  type ITouchInput,
  type ITouchPointer,
  type ITouchViewport,
  MOVE_RADIUS,
  stickDeflection,
  touchControlPoint,
} from "./touch-layout.js";

/** Flat overlay material: drawn over the scene, never occluded by it. */
function overlayMaterial(color: ColorRepresentation, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    opacity,
    transparent: true,
  });
}

/** Controls live on a flat plane, so z is always 0. */
function place(mesh: Mesh, x: number, y: number): void {
  mesh.position.set(x, y, 0);
}

/** The 5px-thick outline every control shares. */
function ringMesh(radius: number, material: MeshBasicMaterial): Mesh {
  return new Mesh(new RingGeometry(radius - 5, radius, 32), material);
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
    this.#idleMaterial = overlayMaterial(palette.shadow, 0.28);
    this.#activeMaterial = overlayMaterial(palette.accent, 0.58);
    this.#moveBase = ringMesh(MOVE_RADIUS, this.#idleMaterial);
    this.#moveKnob = new Mesh(new CircleGeometry(28, 24), this.#activeMaterial);
    this.#dash = ringMesh(BUTTON_RADIUS, this.#idleMaterial);
    this.#jump = ringMesh(BUTTON_RADIUS, this.#idleMaterial);
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
    place(this.#moveKnob, center.x + move.x * MOVE_RADIUS, center.y - move.y * MOVE_RADIUS);
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
    place(this.#moveBase, move.x, move.y);
    place(this.#dash, dash.x, dash.y);
    place(this.#jump, jump.x, jump.y);
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
