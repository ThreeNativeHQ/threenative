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

interface TouchPointer {
  readonly position: Vector2;
}

interface TouchViewport {
  readonly height: number;
  readonly width: number;
}

type TouchControlName = "dash" | "jump" | "move";

export function touchControlPoint(size: TouchViewport, name: TouchControlName): Vector2 {
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

export interface TouchInput {
  readonly dashPressed: boolean;
  readonly jumpPressed: boolean;
  readonly move: Vector2;
}

export class TouchControls {
  readonly root = new Group();
  #camera: PerspectiveCamera;
  #input: TouchInput = { dashPressed: false, jumpPressed: false, move: new Vector2() };
  #wasDash = false;
  #wasJump = false;
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

  update(pointers: ReadonlyMap<number, TouchPointer>, size: TouchViewport): TouchInput {
    const jumpCenter = touchControlPoint(size, "jump");
    const dashCenter = touchControlPoint(size, "dash");
    const jump = this.#at(pointers, jumpCenter, BUTTON_RADIUS);
    const dash = this.#at(pointers, dashCenter, BUTTON_RADIUS);
    const left = [...pointers.values()].find((pointer) =>
      this.#isMovementPointer(pointer, size, dashCenter, jumpCenter),
    );
    const center = touchControlPoint(size, "move");
    const move = this.#input.move;
    if (left === undefined) move.set(0, 0);
    else {
      move.set(
        MathUtils.clamp((left.position.x - center.x) / MOVE_RADIUS, -1, 1),
        MathUtils.clamp((center.y - left.position.y) / MOVE_RADIUS, -1, 1),
      );
    }
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

  #layout(size: TouchViewport): void {
    const worldHeight = 2 * Math.tan(MathUtils.degToRad(this.#camera.fov / 2));
    const pixels = worldHeight / Math.max(1, size.height);
    const worldWidth = size.width * pixels;
    this.root.position.set(-worldWidth / 2, worldHeight / 2, -1);
    this.root.scale.set(pixels, -pixels, 1);
    const move = touchControlPoint(size, "move");
    const dash = touchControlPoint(size, "dash");
    const jump = touchControlPoint(size, "jump");
    this.#moveBase.position.set(move.x, move.y, 0);
    this.#dash.position.set(dash.x, dash.y, 0);
    this.#jump.position.set(jump.x, jump.y, 0);
  }

  #isMovementPointer(
    pointer: TouchPointer,
    size: TouchViewport,
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

  #at(pointers: ReadonlyMap<number, TouchPointer>, center: Vector2, radius: number): boolean {
    const radiusSquared = radius * radius;
    return [...pointers.values()].some(
      (pointer) => pointer.position.distanceToSquared(center) <= radiusSquared,
    );
  }
}
