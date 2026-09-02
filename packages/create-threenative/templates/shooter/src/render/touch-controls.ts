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
const BUTTON_RADIUS = 58;
const EDGE = 36;

export interface ITouchPointer {
  readonly position: Vector2;
}

export interface ITouchViewport {
  readonly height: number;
  readonly width: number;
}

export interface ITouchInput {
  readonly aim: Vector2;
  readonly firePressed: boolean;
  readonly move: Vector2;
}

function overlayMaterial(color: ColorRepresentation, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    opacity,
    transparent: true,
  });
}

function ringMesh(radius: number, material: MeshBasicMaterial): Mesh {
  return new Mesh(new RingGeometry(radius - 5, radius, 32), material);
}

function place(mesh: Mesh, point: Vector2): void {
  mesh.position.set(point.x, point.y, 0);
}

function controlPoint(size: ITouchViewport, name: "aim" | "fire" | "move"): Vector2 {
  if (name === "move") return new Vector2(MOVE_RADIUS + EDGE, size.height - MOVE_RADIUS - EDGE);
  if (name === "aim") {
    return new Vector2(
      Math.max(size.width * 0.6, size.width - BUTTON_RADIUS * 3 - EDGE),
      size.height - MOVE_RADIUS - EDGE,
    );
  }
  return new Vector2(size.width - BUTTON_RADIUS - EDGE, size.height - BUTTON_RADIUS - EDGE);
}

export class TouchControls {
  readonly root = new Group();
  readonly object = this.root;
  #camera: PerspectiveCamera;
  #input: { aim: Vector2; firePressed: boolean; move: Vector2 } = {
    aim: new Vector2(),
    firePressed: false,
    move: new Vector2(),
  };
  #wasFire = false;
  #moveAnchor = new Vector2();
  #aimAnchor = new Vector2();
  #moveResting = new Vector2();
  #aimResting = new Vector2();
  #fireCenter = new Vector2();
  #hasMoveAnchor = false;
  #hasAimAnchor = false;
  #lastWidth = -1;
  #lastHeight = -1;
  #moveBase: Mesh;
  #moveKnob: Mesh;
  #aimBase: Mesh;
  #aimKnob: Mesh;
  #fire: Mesh;
  #idleMaterial: MeshBasicMaterial;
  #activeMaterial: MeshBasicMaterial;

  constructor(camera: PerspectiveCamera) {
    this.#camera = camera;
    this.#idleMaterial = overlayMaterial(palette.arena, 0.38);
    this.#activeMaterial = overlayMaterial(palette.accent, 0.62);
    this.#moveBase = ringMesh(MOVE_RADIUS, this.#idleMaterial);
    this.#moveKnob = new Mesh(new CircleGeometry(28, 24), this.#activeMaterial);
    this.#aimBase = ringMesh(MOVE_RADIUS, this.#idleMaterial);
    this.#aimKnob = new Mesh(new CircleGeometry(28, 24), this.#activeMaterial);
    this.#fire = ringMesh(BUTTON_RADIUS, this.#idleMaterial);
    this.root.add(this.#moveBase, this.#moveKnob, this.#aimBase, this.#aimKnob, this.#fire);
    this.root.renderOrder = 10_001;
    camera.add(this.root);
  }

  update(pointers: ReadonlyMap<number, ITouchPointer>, size: ITouchViewport): ITouchInput {
    this.#ensureLayout(size);
    const fire = this.#at(pointers, this.#fireCenter, BUTTON_RADIUS);
    let movement: ITouchPointer | undefined;
    let aiming: ITouchPointer | undefined;
    for (const pointer of pointers.values()) {
      if (movement === undefined && pointer.position.x < size.width * 0.5) movement = pointer;
      if (aiming === undefined && this.#isAimPointer(pointer)) aiming = pointer;
    }

    this.#updateStick(movement, this.#moveAnchor, "move");
    this.#updateStick(aiming, this.#aimAnchor, "aim");
    this.#input.firePressed = fire && !this.#wasFire;
    this.#wasFire = fire;
    this.#fire.material = fire ? this.#activeMaterial : this.#idleMaterial;
    this.#layout(size);
    return this.#input;
  }

  debug(): Record<string, unknown> {
    return {
      aim: this.#input.aim.toArray(),
      fire: this.#wasFire,
      move: this.#input.move.toArray(),
    };
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const child of this.root.children) {
      if (child instanceof Mesh) child.geometry.dispose();
    }
    this.#idleMaterial.dispose();
    this.#activeMaterial.dispose();
  }

  #ensureLayout(size: ITouchViewport): void {
    if (size.width === this.#lastWidth && size.height === this.#lastHeight) return;
    this.#lastWidth = size.width;
    this.#lastHeight = size.height;
    this.#moveResting.copy(controlPoint(size, "move"));
    this.#aimResting.copy(controlPoint(size, "aim"));
    this.#fireCenter.copy(controlPoint(size, "fire"));
  }

  #updateStick(pointer: ITouchPointer | undefined, anchor: Vector2, stick: "aim" | "move"): void {
    const hasAnchor = stick === "move" ? this.#hasMoveAnchor : this.#hasAimAnchor;
    if (pointer === undefined) {
      if (stick === "move") this.#hasMoveAnchor = false;
      else this.#hasAimAnchor = false;
      this.#input[stick].set(0, 0);
      return;
    }
    if (!hasAnchor) {
      anchor.copy(pointer.position);
      if (stick === "move") this.#hasMoveAnchor = true;
      else this.#hasAimAnchor = true;
    }
    this.#input[stick].set(
      MathUtils.clamp((pointer.position.x - anchor.x) / MOVE_RADIUS, -1, 1),
      MathUtils.clamp((anchor.y - pointer.position.y) / MOVE_RADIUS, -1, 1),
    );
  }

  #layout(size: ITouchViewport): void {
    const worldHeight = 2 * Math.tan(MathUtils.degToRad(this.#camera.fov / 2));
    const pixels = worldHeight / Math.max(1, size.height);
    this.root.position.set(-(size.width * pixels) / 2, worldHeight / 2, -1);
    this.root.scale.set(pixels, -pixels, 1);
    place(this.#moveBase, this.#hasMoveAnchor ? this.#moveAnchor : this.#moveResting);
    place(
      this.#moveKnob,
      this.#stickKnobPosition(
        this.#moveAnchor,
        this.#moveResting,
        this.#input.move,
        this.#hasMoveAnchor,
      ),
    );
    place(this.#aimBase, this.#hasAimAnchor ? this.#aimAnchor : this.#aimResting);
    place(
      this.#aimKnob,
      this.#stickKnobPosition(
        this.#aimAnchor,
        this.#aimResting,
        this.#input.aim,
        this.#hasAimAnchor,
      ),
    );
    place(this.#fire, this.#fireCenter);
  }

  #stickKnobPosition(
    anchor: Vector2,
    resting: Vector2,
    value: Vector2,
    anchored: boolean,
  ): Vector2 {
    const center = anchored ? anchor : resting;
    return new Vector2(center.x + value.x * MOVE_RADIUS, center.y - value.y * MOVE_RADIUS);
  }

  #isAimPointer(pointer: ITouchPointer): boolean {
    return (
      pointer.position.x > this.#aimResting.x - MOVE_RADIUS &&
      pointer.position.distanceToSquared(this.#fireCenter) > BUTTON_RADIUS * BUTTON_RADIUS
    );
  }

  #at(pointers: ReadonlyMap<number, ITouchPointer>, center: Vector2, radius: number): boolean {
    const radiusSquared = radius * radius;
    for (const pointer of pointers.values()) {
      if (pointer.position.distanceToSquared(center) <= radiusSquared) return true;
    }
    return false;
  }
}
