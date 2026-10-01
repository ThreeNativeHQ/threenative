import {
  type ISnowFootprint,
  type ISnowFootprintSample,
  type SnowField,
  snowDiscFootprint,
} from "@threenative/core/world";
import type { CollisionShape3D } from "./CollisionShape3D.js";
import type { IPhysicsColliderHandle } from "./handles.js";
import type { IPhysicsContext, PhysicsBody3D } from "./plugin.js";
import {
  type IPhysicsShapeDescriptor,
  type PhysicsShapeKind,
  PHYSICS_CONTACT_STRIDE,
} from "./simulation.js";

const ZERO_SAMPLE: ISnowFootprintSample = {
  bank: 0,
  coverage: 0,
  disturbance: 0,
  relief: 0,
  shape: 0,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`attachSnowPhysics ${name} must be a positive finite number.`);
  return value;
}

/**
 * A stadium contact: a rectangle of half-length `halfHeight` and half-width `radius`, capped by
 * two half-discs of `radius`. The shape a capsule lies on, so a knocked-over body sinks along a
 * line instead of at a point.
 * @situation let a fallen capsule, limb or barrel leave a linear imprint in snow
 * @situation give a capsule a shape-appropriate snow contact instead of a sphere's dot
 * @constraint radius and halfHeight are metres and never grow with load
 * @example const footprint = capsuleFootprint(0.5, 0.2);
 */
export function capsuleFootprint(halfHeight: number, radius: number): ISnowFootprint {
  positive(radius, "capsule radius");
  if (!Number.isFinite(halfHeight) || halfHeight < 0)
    throw new Error("attachSnowPhysics capsule halfHeight must be a non-negative finite number.");
  const softness = 0.2 * radius;
  return {
    extent: halfHeight + radius + softness,
    sample: (x, z) => {
      // Distance to the capsule's spine: a segment from -halfHeight to +halfHeight on local z.
      const along = clamp(z, -halfHeight, halfHeight);
      const distance = Math.hypot(x, z - along);
      if (distance >= radius + softness) return ZERO_SAMPLE;
      const coverage = distance <= radius ? 1 : 1 - smoothstep(radius, radius + softness, distance);
      const bank = distance > radius ? 1 - (distance - radius) / softness : 0;
      return {
        bank,
        coverage,
        disturbance: Math.max(coverage, bank * 0.5),
        relief: 0,
        shape: 1,
      };
    },
  };
}

/**
 * A rectangular contact: the face a box rests on, in the contact's own frame.
 * @situation let a crate, platform or plank press a rectangular pit into snow
 * @situation imprint a box's own footprint rather than a circle around it
 * @constraint halfWidth and halfDepth are metres; rotation comes from the contact, not the footprint
 * @example const footprint = boxFootprint(0.4, 0.25);
 */
export function boxFootprint(halfWidth: number, halfDepth: number): ISnowFootprint {
  positive(halfWidth, "box halfWidth");
  positive(halfDepth, "box halfDepth");
  const edge = 0.15 * Math.min(halfWidth, halfDepth);
  return {
    extent: Math.hypot(halfWidth, halfDepth) + edge,
    sample: (x, z) => {
      const inside = Math.max(Math.abs(x) - halfWidth, Math.abs(z) - halfDepth);
      if (inside > edge) return ZERO_SAMPLE;
      const coverage = 1 - smoothstep(-edge, edge, inside);
      return {
        bank: inside > 0 ? 1 - inside / edge : 0,
        coverage,
        disturbance: coverage,
        relief: 0,
        shape: 1,
      };
    },
  };
}

/** The automatic footprint a supported shape presses, or undefined when there is none. */
function automaticFootprint(shape: IPhysicsShapeDescriptor): ISnowFootprint | undefined {
  if (shape.kind === "sphere") return snowDiscFootprint(shape.x);
  if (shape.kind === "box") return boxFootprint(shape.x, shape.z);
  if (shape.kind === "capsule") return capsuleFootprint(shape.x, shape.y);
  return undefined;
}

/** Shape kinds `attachSnowPhysics` can derive an automatic contact profile for. */
const SUPPORTED_SHAPES: readonly PhysicsShapeKind[] = ["sphere", "box", "capsule"];

export interface ISnowPhysicsOptions {
  /** The physics context whose solved steps drive the deformation. */
  readonly physics: IPhysicsContext;
  /** The snow surface these bodies deform. */
  readonly snow: SnowField;
  /** Bodies to watch from the start. Register more later with `add`. */
  readonly bodies?: readonly PhysicsBody3D[];
  /** Collision layer of the generated snow surface collider. Default 1. */
  readonly collisionLayer?: number;
  /** Collision mask of the generated snow surface collider. Default 0xffff. */
  readonly collisionMask?: number;
  /** Multiplier turning a solved contact impulse into load. Default 1. */
  readonly loadScale?: number;
  /** Smallest contact-normal height that counts as support. Default 0.35. */
  readonly supportNormal?: number;
  /** Snowfall deposition in metres per second, forwarded to `SnowField.recover`. Default 0. */
  readonly deposition?: number;
  /** Wind erosion in metres per second, forwarded to `SnowField.recover`. Default 0. */
  readonly wind?: number;
}

export interface ISnowPhysicsBinding {
  /** The generated snow surface collider. Its identity survives every deformation. */
  readonly surface: IPhysicsColliderHandle;
  /** Canonical surface version the live collider was last built from. */
  readonly surfaceVersion: number;
  /** Solved contacts read in the most recent step. */
  readonly contacts: number;
  /** Of those, the ones that were supported and downward-loaded. */
  readonly supported: number;
  /** Snow surface version at the last step this binding ran. */
  readonly version: number;
  add(body: PhysicsBody3D, footprint?: ISnowFootprint): void;
  remove(body: PhysicsBody3D): void;
  /**
   * Consume one solved step: read contacts, deform the snow, let it recover, then publish the
   * changed surface to collision. Call it once per fixed step, after the physics step and before
   * the next one.
   */
  step(deltaTime: number): void;
  /** Idempotent cleanup: removes the surface body and forgets every watched body. */
  dispose(): void;
}

/**
 * Drive a `SnowField` from real solved contacts.
 *
 * The binding creates the snow surface collider from the field's own canonical samples and keeps
 * it in step with them, so a body lands on the surface a query would report. Each fixed step it
 * reads the solver's persistent contacts — not collision start/stop events, which carry no point
 * or load — deforms the snow only where a contact is supported and loaded downward, then
 * republishes the surface. Airborne bodies, side contacts with scenery and unrelated colliders
 * never deform anything.
 *
 * A dropped sphere settles on the surface it made; a pushed one rotates and carves a connected
 * track without its transform being copied anywhere. Foot profiles come from the body's own
 * collision shape unless the game supplies one.
 *
 * Contact load is `impulse / deltaTime * loadScale`: a solver impulse over a step, which is an
 * approximation of a contact force and is not measured. `loadScale` exists to calibrate it.
 * @situation leave footprints and tracks where physical bodies actually touch snow
 * @situation let a dropped or pushed sphere carve and settle into deformable snow
 * @situation make a crate, capsule or ball compress the surface it rests on
 * @constraint register `rapier()` before attaching, and call `step` once per fixed step after the physics step
 * @constraint only a backend exposing persistent solved contacts and in-place shape refresh can attach; native and unknown backends fail closed
 * @constraint automatic profiles cover sphere, box and capsule; any other shape needs an explicit footprint
 * @override loadScale, supportNormal, deposition, wind, collisionLayer and collisionMask name the binding's own behaviour
 * @requires @threenative/core/world SnowField as the surface it deforms
 * @example const snowPhysics = attachSnowPhysics({ physics: ctx.physics, snow, bodies: [ball] });
 * afterPhysics(ctx, (dt) => snowPhysics.step(dt));
 */
export function attachSnowPhysics(options: ISnowPhysicsOptions): ISnowPhysicsBinding {
  const simulation = options.physics.simulation;
  if (typeof simulation.readContacts !== "function" || typeof simulation.setColliderShape !== "function")
    throw new Error(
      "attachSnowPhysics requires a physics backend with persistent solved contacts and in-place shape refresh; the selected backend provides neither.",
    );
  const readContacts = simulation.readContacts.bind(simulation);
  const setColliderShape = simulation.setColliderShape.bind(simulation);
  const snow = options.snow;
  const field = snow.field;
  const loadScale = finiteOr(options.loadScale, 1, "loadScale");
  const supportNormal = clamp(finiteOr(options.supportNormal, 0.35, "supportNormal"), 0, 1);
  const deposition = Math.max(0, finiteOr(options.deposition, 0, "deposition"));
  const wind = Math.max(0, finiteOr(options.wind, 0, "wind"));

  const watched = new Map<number, ISnowFootprint>();
  let surfaceVersion = -1;
  let contacts = 0;
  let supported = 0;
  let version = 0;
  let disposed = false;

  function surfaceDescriptor(): IPhysicsShapeDescriptor {
    return {
      collisionLayer: options.collisionLayer ?? 1,
      collisionMask: options.collisionMask ?? 0xffff,
      columns: field.columns,
      heights: field.toColliderHeights(),
      kind: "heightfield",
      rows: field.rows,
      // Rapier's heightfield scale is the full extent, and its own axis order is the transposed
      // buffer `toColliderHeights` already produced.
      scale: { x: field.width, y: 1, z: field.depth },
      sensor: false,
      x: 0,
      y: 0,
      z: 0,
    };
  }

  const registration = simulation.createBody({
    entity: "threenative.snow.surface",
    mass: 0,
    position: { x: field.origin.x, y: 0, z: field.origin.z },
    rotation: { w: 1, x: 0, y: 0, z: 0 },
    sensor: false,
    shape: surfaceDescriptor(),
    type: "fixed",
  });
  const surface = registration.collider;
  const surfaceBody = registration.body;
  surfaceVersion = snow.version;

  const contactBuffer = new Float32Array(PHYSICS_CONTACT_STRIDE * 512);
  let colliderScratch = new Uint32Array(8);

  function refreshSurface(): void {
    if (snow.version === surfaceVersion) return;
    setColliderShape(surface, surfaceDescriptor());
    surfaceVersion = snow.version;
  }

  function colliderIds(): Uint32Array {
    if (colliderScratch.length < watched.size) colliderScratch = new Uint32Array(watched.size * 2);
    let index = 0;
    for (const id of watched.keys()) {
      colliderScratch[index] = id;
      index += 1;
    }
    return colliderScratch.subarray(0, index);
  }

  function add(body: PhysicsBody3D, footprint?: ISnowFootprint): void {
    if (disposed) throw new Error("attachSnowPhysics binding is disposed.");
    // A character's own collision shape is not part of its public surface, so only bodies that
    // publish one get an automatic profile; everyone else names the footprint explicitly.
    const shape = (body as { readonly shape?: CollisionShape3D }).shape;
    const profile = footprint ?? (shape === undefined ? undefined : automaticFootprint(shape.descriptor));
    if (profile === undefined) {
      const kind = shape?.descriptor.kind ?? "unknown";
      throw new Error(
        `attachSnowPhysics cannot derive a contact profile for a '${kind}' shape; supported shapes are ${SUPPORTED_SHAPES.join(", ")}. Pass an explicit footprint instead.`,
      );
    }
    watched.set(body.collider.id, profile);
  }

  return {
    add,
    get contacts() {
      return contacts;
    },
    get supported() {
      return supported;
    },
    get surface() {
      return surface;
    },
    get surfaceVersion() {
      return surfaceVersion;
    },
    get version() {
      return version;
    },
    remove(body: PhysicsBody3D): void {
      watched.delete(body.collider.id);
    },
    step(deltaTime: number): void {
      if (disposed) return;
      if (!Number.isFinite(deltaTime) || deltaTime <= 0)
        throw new Error("attachSnowPhysics step requires a positive finite delta time.");
      contacts = 0;
      supported = 0;
      if (watched.size > 0) {
        const ids = colliderIds();
        const found = readContacts(surface, ids, contactBuffer);
        contacts = found;
        const capacity = Math.floor(contactBuffer.length / PHYSICS_CONTACT_STRIDE);
        if (found > capacity)
          throw new Error("attachSnowPhysics read past its contact buffer.");
        for (let index = 0; index < found; index += 1) {
          const offset = index * PHYSICS_CONTACT_STRIDE;
          const collider = contactBuffer[offset] as number;
          const footprint = watched.get(collider);
          if (footprint === undefined) continue;
          const normalY = contactBuffer[offset + 5] as number;
          // Only a surface pushing up on the body, and a body pressing down on it, deform snow.
          if (normalY < supportNormal) continue;
          const impulse = Math.abs(contactBuffer[offset + 7] as number);
          if (impulse <= 0) continue;
          snow.stamp({
            area: footprintArea(footprint),
            footprint,
            load: (impulse / deltaTime) * loadScale,
            x: contactBuffer[offset + 1] as number,
            z: contactBuffer[offset + 3] as number,
          });
          supported += 1;
        }
      }
      if (deposition > 0 || wind > 0) snow.recover(deltaTime, deposition, wind);
      refreshSurface();
      version = snow.version;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      watched.clear();
      simulation.removeBody(surfaceBody.id);
    },
  };
}

function finiteOr(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new Error(`attachSnowPhysics ${name} must be finite.`);
  return value;
}

/**
 * Smallest area a contact is allowed to claim.
 *
 * The snow model divides load by area, so a degenerate profile that reports a near-zero area
 * would produce an unbounded pressure. The floor is the model's own guard, not a physical claim.
 */
const MIN_CONTACT_AREA = 1e-4;

const footprintAreas = new WeakMap<ISnowFootprint, number>();

/**
 * The area a footprint actually covers, measured once per profile and then remembered.
 *
 * A footprint is a shape, never a load, so its supported area is a property of the shape. It is
 * measured with a bounded sweep rather than trusted to a hardcoded constant, and floored so a
 * degenerate profile cannot turn a finite load into an unbounded pressure.
 */
function footprintArea(footprint: ISnowFootprint): number {
  const cached = footprintAreas.get(footprint);
  if (cached !== undefined) return cached;
  const steps = 24;
  const step = (footprint.extent * 2) / steps;
  let area = 0;
  for (let row = 0; row < steps; row += 1) {
    const z = -footprint.extent + (row + 0.5) * step;
    for (let column = 0; column < steps; column += 1) {
      const x = -footprint.extent + (column + 0.5) * step;
      area += footprint.sample(x, z).coverage * step * step;
    }
  }
  const measured = Math.max(area, MIN_CONTACT_AREA);
  footprintAreas.set(footprint, measured);
  return measured;
}
