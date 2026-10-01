import type { InputMap } from "@threenative/core";
import { MathUtils, type PerspectiveCamera, type Vector3 } from "three";
import { START_YAW, ZOOM_MAX, ZOOM_MIN, placeCamera } from "./render/camera.js";

const DRAG_YAW_PER_PIXEL = 0.006;
const KEY_TURN = Math.PI / 8;
const WHEEL_ZOOM = 0.12;
/** Metres per second the view slides at zoom 1, and how far from the board's centre it may go. */
const PAN_SPEED = 14;
const PAN_LIMIT = { x: 12, z: 8 } as const;

/**
 * The orbit camera: WASD or the arrows pan it, right-drag turns the board, the wheel (or a pinch)
 * zooms, Q and E turn it an eighth of a circle. Panning is relative to the view, so "up" is always
 * up the screen however the board is turned, and it is clamped so a player can never lose the
 * board. The shake offset from a leak or a strike is added on top after the orbit is placed.
 */
export class CameraRig {
  yaw = START_YAW;
  zoom = 1;
  panX = 0;
  panZ = 0;
  #lastX = 0;
  #dragging = false;

  update(
    camera: PerspectiveCamera,
    input: Pick<InputMap, "axis" | "justPressed" | "pressed" | "vector">,
    pointerX: number,
    dt: number,
    shake?: Vector3,
  ): void {
    const dragging = input.pressed("orbit");
    if (dragging && this.#dragging) this.yaw -= (pointerX - this.#lastX) * DRAG_YAW_PER_PIXEL;
    this.#dragging = dragging;
    this.#lastX = pointerX;
    if (input.justPressed("turnLeft")) this.yaw += KEY_TURN;
    if (input.justPressed("turnRight")) this.yaw -= KEY_TURN;
    this.zoom = MathUtils.clamp(
      this.zoom * (1 + input.axis("zoom") * WHEEL_ZOOM),
      ZOOM_MIN,
      ZOOM_MAX,
    );
    // `vector("move").y` is +up; the view's "up the screen" on the ground is away from the camera.
    const move = input.vector("move");
    const reach = (PAN_SPEED / this.zoom) * dt;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.panX = MathUtils.clamp(
      this.panX + (cos * move.x - sin * move.y) * reach,
      -PAN_LIMIT.x,
      PAN_LIMIT.x,
    );
    this.panZ = MathUtils.clamp(
      this.panZ + (-sin * move.x - cos * move.y) * reach,
      -PAN_LIMIT.z,
      PAN_LIMIT.z,
    );
    placeCamera(camera, this.yaw, this.zoom, this.panX, this.panZ);
    if (shake !== undefined) camera.position.add(shake);
  }
}
