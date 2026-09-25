// Minimal structural typing for the two upstream 0.7.8 exports used here.
// No runtime shim: npm supplies the actual Yuka implementation.
declare module 'yuka' {
  export class Vector3 { x: number; y: number; z: number; set(x: number, y: number, z: number): this; }
  export class Vision {
    constructor(owner: {getWorldPosition(out: Vector3): unknown; getWorldDirection(out: Vector3): unknown});
    fieldOfView: number;
    range: number;
    visible(point: Vector3): boolean;
  }
}
