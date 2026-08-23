import { type ICtx, Scene } from "@threenative/core";
import {
  CharacterBody3D,
  CollisionShape3D,
  type IPhysicsContext,
  RigidBody3D,
} from "@threenative/physics";
import { NavigationAgent3D, NavigationRegion3D } from "@threenative/physics/navigation";
import { BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";

const TARGET = new Vector3(0, 0.75, 0);
const SPEED = 3.4;

export interface INavigationState extends Record<string, unknown> {
  distanceToTarget: number;
}

type NavigationCtx = ICtx<INavigationState, IPhysicsContext>;

class Navigator {
  readonly mesh: Mesh;
  readonly #agent: NavigationAgent3D;
  readonly #body: CharacterBody3D;
  readonly #direction = new Vector3();
  readonly #next = new Vector3();

  constructor(ctx: NavigationCtx, navigation: NonNullable<IPhysicsContext["navigation"]>) {
    this.mesh = new Mesh(
      new BoxGeometry(0.7, 1.4, 0.7),
      new MeshBasicMaterial({ color: 0xffc857 }),
    );
    this.mesh.position.set(7.5, 0.75, 0);
    ctx.add(this.mesh);
    this.#body = new CharacterBody3D({
      gravity: 0,
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.capsule(0.35, 0.35),
    });
    this.#agent = new NavigationAgent3D({
      avoidanceEnabled: false,
      maxSpeed: SPEED,
      navigation,
      object: this.mesh,
      targetDesiredDistance: 0.5,
    });
    this.#agent.setTargetPosition(TARGET);
  }

  update(dt: number): void {
    this.#agent.getNextPathPosition(this.#next);
    this.#direction.subVectors(this.#next, this.mesh.position).setY(0);
    if (this.#direction.lengthSq() > 0.0001) this.#direction.normalize().multiplyScalar(SPEED);
    else this.#direction.set(0, 0, 0);
    this.#body.velocity.copy(this.#direction);
    this.#body.moveAndSlide(dt);
  }

  debug(): Record<string, unknown> {
    return {
      navigationFinished: this.#agent.isNavigationFinished(),
      position: this.mesh.position.toArray(),
      targetDistance: this.mesh.position.distanceTo(TARGET),
      targetReachable: this.#agent.isTargetReachable(),
    };
  }

  dispose(): void {
    this.#agent.dispose();
    this.#body.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}

export class NavigationProbe extends Scene<INavigationState, IPhysicsContext> {
  static override readonly initialState = { distanceToTarget: 7.5 };

  override enter(ctx: NavigationCtx): (frameCtx: NavigationCtx, dt: number) => void {
    const floor = new Mesh(new BoxGeometry(18, 0.4, 7), new MeshBasicMaterial({ color: 0x335c67 }));
    floor.position.y = -0.2;
    const blocker = new Mesh(
      new BoxGeometry(0.6, 1.6, 5.2),
      new MeshBasicMaterial({ color: 0x9e2a2b }),
    );
    blocker.position.set(3.4, 0.8, 0);
    ctx.add(floor);
    ctx.add(blocker);
    new RigidBody3D({
      object: floor,
      physics: ctx.physics,
      shape: CollisionShape3D.box(18, 0.4, 7),
      type: "fixed",
    });
    new RigidBody3D({
      object: blocker,
      physics: ctx.physics,
      shape: CollisionShape3D.box(0.6, 1.6, 5.2),
      type: "fixed",
    });
    const navigation = ctx.physics.navigation;
    if (navigation === undefined) throw new Error("Navigation probe requires recast().");
    new NavigationRegion3D({ meshes: [floor, blocker], navigation });
    const navigator = new Navigator(ctx, navigation);
    ctx.entities.add("navigator", navigator);
    ctx.camera.position.set(4, 14, 18);
    ctx.camera.lookAt(4, 0, 0);
    return (frameCtx, dt) => {
      navigator.update(dt);
      frameCtx.state.set({ distanceToTarget: navigator.mesh.position.distanceTo(TARGET) });
    };
  }
}
