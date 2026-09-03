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
/** The three secondary pads: smaller than fire, because they are pressed less often. */
const SMALL_RADIUS = 34;

export interface ITouchPointer {
  readonly position: Vector2;
}

export interface ITouchViewport {
  readonly height: number;
  readonly width: number;
}

export interface ITouchInput {
  /** Right thumb: a look delta in stick units, which the player converts to yaw and pitch. */
  readonly aim: Vector2;
  /** Held, not edge-triggered: down the sights for as long as the thumb is on the pad. */
  readonly aimPressed: boolean;
  readonly crouchPressed: boolean;
  /** Edge-triggered, so resting a thumb on the trigger does not empty the magazine. */
  readonly firePressed: boolean;
  readonly move: Vector2;
  readonly reloadPressed: boolean;
  /**
   * Pushing the movement stick to its rim sprints.
   *
   * A fourth button would be a fourth thing to find under a thumb. The stick already carries the
   * intent — a player who wants to go faster pushes harder — and the same two vetoes that stop a
   * keyboard sprint (aiming, crouching) apply to it in `Player.update`.
   */
  readonly sprintPressed: boolean;
}

/** How far out the movement stick has to go before it reads as a sprint. */
const SPRINT_THRESHOLD = 0.92;

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

type ControlName = "aim" | "ads" | "crouch" | "fire" | "move" | "reload";

function controlPoint(size: ITouchViewport, name: ControlName): Vector2 {
  if (name === "move") return new Vector2(MOVE_RADIUS + EDGE, size.height - MOVE_RADIUS - EDGE);
  if (name === "aim") {
    return new Vector2(
      Math.max(size.width * 0.6, size.width - BUTTON_RADIUS * 3 - EDGE),
      size.height - MOVE_RADIUS - EDGE,
    );
  }
  if (name === "ads") {
    return new Vector2(
      size.width - BUTTON_RADIUS - EDGE,
      size.height - BUTTON_RADIUS * 3 - EDGE - SMALL_RADIUS,
    );
  }
  if (name === "reload") {
    return new Vector2(
      size.width - BUTTON_RADIUS * 2 - EDGE - SMALL_RADIUS,
      size.height - SMALL_RADIUS - EDGE,
    );
  }
  if (name === "crouch")
    return new Vector2(MOVE_RADIUS + EDGE, size.height - MOVE_RADIUS * 2 - EDGE - SMALL_RADIUS);
  return new Vector2(size.width - BUTTON_RADIUS - EDGE, size.height - BUTTON_RADIUS - EDGE);
}

export class TouchControls {
  readonly root = new Group();
  readonly object = this.root;
  #camera: PerspectiveCamera;
  #input: {
    aim: Vector2;
    aimPressed: boolean;
    crouchPressed: boolean;
    firePressed: boolean;
    move: Vector2;
    reloadPressed: boolean;
    sprintPressed: boolean;
  } = {
    aim: new Vector2(),
    aimPressed: false,
    crouchPressed: false,
    firePressed: false,
    move: new Vector2(),
    reloadPressed: false,
    sprintPressed: false,
  };
  #wasFire = false;
  #wasReload = false;
  #moveAnchor = new Vector2();
  #aimAnchor = new Vector2();
  #moveResting = new Vector2();
  #aimResting = new Vector2();
  #fireCenter = new Vector2();
  #adsCenter = new Vector2();
  #reloadCenter = new Vector2();
  #crouchCenter = new Vector2();
  #hasMoveAnchor = false;
  #hasAimAnchor = false;
  #lastWidth = -1;
  #lastHeight = -1;
  #moveBase: Mesh;
  #moveKnob: Mesh;
  #aimBase: Mesh;
  #aimKnob: Mesh;
  #fire: Mesh;
  #ads: Mesh;
  #reload: Mesh;
  #crouch: Mesh;
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
    this.#ads = ringMesh(SMALL_RADIUS, this.#idleMaterial);
    this.#reload = ringMesh(SMALL_RADIUS, this.#idleMaterial);
    this.#crouch = ringMesh(SMALL_RADIUS, this.#idleMaterial);
    this.root.add(
      this.#moveBase,
      this.#moveKnob,
      this.#aimBase,
      this.#aimKnob,
      this.#fire,
      this.#ads,
      this.#reload,
      this.#crouch,
    );
    this.root.renderOrder = 10_001;
    camera.add(this.root);
  }

  update(pointers: ReadonlyMap<number, ITouchPointer>, size: ITouchViewport): ITouchInput {
    this.#ensureLayout(size);
    const fire = this.#at(pointers, this.#fireCenter, BUTTON_RADIUS);
    const ads = this.#at(pointers, this.#adsCenter, SMALL_RADIUS);
    const reload = this.#at(pointers, this.#reloadCenter, SMALL_RADIUS);
    const crouch = this.#at(pointers, this.#crouchCenter, SMALL_RADIUS);
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
    this.#input.reloadPressed = reload && !this.#wasReload;
    this.#wasReload = reload;
    this.#input.aimPressed = ads;
    this.#input.crouchPressed = crouch;
    this.#input.sprintPressed = this.#input.move.length() >= SPRINT_THRESHOLD;
    this.#fire.material = fire ? this.#activeMaterial : this.#idleMaterial;
    this.#ads.material = ads ? this.#activeMaterial : this.#idleMaterial;
    this.#reload.material = reload ? this.#activeMaterial : this.#idleMaterial;
    this.#crouch.material = crouch ? this.#activeMaterial : this.#idleMaterial;
    this.#layout(size);
    return this.#input;
  }

  debug(): Record<string, unknown> {
    return {
      aim: this.#input.aim.toArray(),
      ads: this.#input.aimPressed ? 1 : 0,
      crouch: this.#input.crouchPressed ? 1 : 0,
      fire: this.#wasFire,
      move: this.#input.move.toArray(),
      sprint: this.#input.sprintPressed ? 1 : 0,
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
    this.#adsCenter.copy(controlPoint(size, "ads"));
    this.#reloadCenter.copy(controlPoint(size, "reload"));
    this.#crouchCenter.copy(controlPoint(size, "crouch"));
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
    place(this.#ads, this.#adsCenter);
    place(this.#reload, this.#reloadCenter);
    place(this.#crouch, this.#crouchCenter);
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
