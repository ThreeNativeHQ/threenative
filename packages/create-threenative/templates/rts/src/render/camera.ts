// Generated for you. Camera framing is yours to edit.
//
// The strategy camera: an orthographic rig at a fixed pitch, panned and zoomed over a ground
// point. Orthographic because that is what a battlefield reads as — the far side of the map is
// the same size as the near side, and a `tank` two grids away is the size of the one under the
// cursor. Every metre here is a metre in the simulation's own coordinate system.
import { type Camera, type OrthographicCamera, Vector2, Vector3 } from "three";
import { HALF, terrainHeight } from "../sim/terrain.js";
import type { IPoint } from "../sim/types.js";

/** Where the camera sits relative to the point it looks at: up and behind, over the shoulder. */
const OFFSET = new Vector3(43, 62, 58);
/** Never inside the map edge, so the frame always holds some battlefield. */
const MARGIN = 14;
export const ZOOM_RANGE = { far: 64, near: 17 } as const;
const ZOOM_STEP = 2.4;
/** How fast a key or an edge-scroll pans, in view-heights per second scaled by the zoom. */
const PAN_SPEED = 1.2;
/** Pointer distance from the edge, in pixels, that starts an edge scroll. */
export const EDGE = 12;

export interface IRtsView {
  /** The ground point under the middle of the frame. */
  readonly target: Vector3;
  /** Eased toward `desiredZoom`, so a wheel notch is a move rather than a jump. */
  zoom: number;
  desiredZoom: number;
}

export interface IViewSize {
  readonly height: number;
  readonly width: number;
}

const _origin = new Vector3();
const _direction = new Vector3();
const _ndc = new Vector3();

export function createRtsView(x: number, z: number): IRtsView {
  return { desiredZoom: 30, target: new Vector3(x, 0, z), zoom: 30 };
}

/** Clamp, ease, and hand the camera a frustum that covers exactly `zoom` metres vertically. */
export function applyRtsCamera(
  camera: OrthographicCamera,
  view: IRtsView,
  size: IViewSize,
  dt: number,
): void {
  view.zoom += (view.desiredZoom - view.zoom) * Math.min(1, dt * 12);
  const aspect = size.width / Math.max(1, size.height);
  camera.left = -view.zoom * aspect;
  camera.right = view.zoom * aspect;
  camera.top = view.zoom;
  camera.bottom = -view.zoom;
  camera.near = 1;
  camera.far = 600;
  camera.updateProjectionMatrix();
  camera.position.copy(view.target).add(OFFSET);
  camera.lookAt(view.target);
  camera.updateMatrixWorld();
}

export function panRts(view: IRtsView, dx: number, dz: number): void {
  view.target.x = Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, view.target.x + dx));
  view.target.z = Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, view.target.z + dz));
}

export function focusRts(view: IRtsView, x: number, z: number): void {
  view.target.set(
    Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, x)),
    0,
    Math.max(-HALF + MARGIN, Math.min(HALF - MARGIN, z)),
  );
}

/** Metres per second the camera travels at the current zoom: a constant on-screen speed. */
export function panSpeed(view: IRtsView): number {
  return view.zoom * PAN_SPEED;
}

export function zoomRts(view: IRtsView, notches: number): void {
  view.desiredZoom = Math.max(
    ZOOM_RANGE.near,
    Math.min(ZOOM_RANGE.far, view.desiredZoom + notches * ZOOM_STEP),
  );
}

/**
 * The ground under a pixel, by marching the orthographic ray down onto `terrainHeight`.
 *
 * A ray against the displaced mesh would be exact; a handful of height queries is exact enough
 * for a click and needs no second copy of the terrain in the picking layer, which is what would
 * otherwise have to be kept in step with the one that is drawn.
 */
export function groundAt(camera: Camera, sx: number, sy: number, size: IViewSize): IPoint | null {
  _ndc.set((sx / size.width) * 2 - 1, -(sy / size.height) * 2 + 1, -1).unproject(camera);
  _origin.copy(_ndc);
  _direction.set(0, 0, -1).transformDirection(camera.matrixWorld);
  if (Math.abs(_direction.y) < 1e-5) return null;
  let t = (terrainHeight(_origin.x, _origin.z) - _origin.y) / _direction.y;
  for (let pass = 0; pass < 6; pass += 1) {
    const x = _origin.x + _direction.x * t;
    const z = _origin.z + _direction.z * t;
    t = (terrainHeight(x, z) - _origin.y) / _direction.y;
  }
  return {
    x: _origin.x + _direction.x * t,
    z: _origin.z + _direction.z * t,
  };
}

/** A world point in viewport pixels, for the bars and rings that hang above the ground. */
export function toScreen(
  camera: Camera,
  x: number,
  y: number,
  z: number,
  size: IViewSize,
): Vector2 {
  _ndc.set(x, y, z).project(camera);
  return new Vector2((_ndc.x * 0.5 + 0.5) * size.width, (-_ndc.y * 0.5 + 0.5) * size.height);
}
