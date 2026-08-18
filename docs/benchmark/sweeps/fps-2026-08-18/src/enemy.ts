import * as THREE from "three";
import type { World } from "./world";
import { groundHeight, resolveCollisions } from "./world";

export type EnemyState = "patrol" | "suspicious" | "engage" | "search" | "return" | "dead";

const PATROL_ROUTE: Array<[number, number]> = [
  [-2.5, -14.0],
  [5.0, -14.5],
  [11.5, -8.5],
  [4.0, -2.5],
  [-6.0, -3.5],
  [-10.5, -9.5],
];

export const ENEMY_HEIGHT = 1.82;
const WALK_SPEED = 2.4;
const CHASE_SPEED = 3.6;
const HEAR_RANGE = 26;
const VIEW_RANGE = 30;
const VIEW_HALF_ANGLE = Math.PI * 0.32;
const ENGAGE_RANGE = 13;
const BURST_ROUNDS = 3;
const BURST_SPACING = 0.13;
const BURST_COOLDOWN = 2.3;
const ROUND_DAMAGE = 9;

/** Deterministic RNG so a scenario replays identically. */
export function makeRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

export interface EnemyShot {
  damage: number;
  origin: THREE.Vector3;
}

export class Enemy {
  readonly root = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  state: EnemyState = "patrol";
  health = 36;
  private waypoint = 0;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current = "";
  private readonly target = new THREE.Vector3();
  private readonly velocity = new THREE.Vector3();
  private alertTimer = 0;
  private searchTimer = 0;
  private burstTimer = BURST_COOLDOWN;
  private burstLeft = 0;
  private strafe = 1;
  private strafeTimer = 0;
  private deadTimer = 0;
  private yaw = 0;
  private readonly lastSeen = new THREE.Vector3();
  private readonly random: () => number;
  private readonly ray = new THREE.Raycaster();

  constructor(private readonly world: World, random: () => number) {
    this.random = random;
    const first = PATROL_ROUTE[0]!;
    this.root.position.set(first[0], 0, first[1]);
    this.hitbox = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, ENEMY_HEIGHT, 0.44),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.hitbox.position.y = ENEMY_HEIGHT / 2;
    this.hitbox.userData.enemy = this;
    this.root.add(this.hitbox);
    this.target.set(first[0], 0, first[1]);
  }

  attachModel(gltfScene: THREE.Object3D, clips: THREE.AnimationClip[]): void {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const scale = size.y > 0 ? ENEMY_HEIGHT / size.y : 1;
    gltfScene.scale.multiplyScalar(scale);
    const scaled = new THREE.Box3().setFromObject(gltfScene);
    gltfScene.position.y -= scaled.min.y;
    const centre = new THREE.Vector3();
    scaled.getCenter(centre);
    gltfScene.position.x -= centre.x;
    gltfScene.position.z -= centre.z;
    gltfScene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = true;
        node.frustumCulled = false;
      }
    });
    const holder = new THREE.Group();
    holder.add(gltfScene);
    this.root.add(holder);

    this.mixer = new THREE.AnimationMixer(gltfScene);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
    }
    this.play("RifleIdle");
  }

  private play(name: string, once = false): void {
    if (this.current === name) return;
    const next = this.actions.get(name);
    if (!next) return;
    const previous = this.current ? this.actions.get(this.current) : undefined;
    next.reset();
    next.enabled = true;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.fadeIn(0.16).play();
    if (previous) previous.fadeOut(0.16);
    this.current = name;
  }

  reset(): void {
    this.health = 36;
    this.state = "patrol";
    this.waypoint = 0;
    const first = PATROL_ROUTE[0]!;
    this.root.position.set(first[0], 0, first[1]);
    this.target.set(first[0], 0, first[1]);
    this.burstLeft = 0;
    this.burstTimer = BURST_COOLDOWN;
    this.deadTimer = 0;
    this.alertTimer = 0;
    this.play("RifleIdle");
  }

  /** Player fired: the enemy hears it if close enough. */
  hearShot(playerPosition: THREE.Vector3): void {
    if (this.state === "dead") return;
    if (this.root.position.distanceTo(playerPosition) > HEAR_RANGE) return;
    this.lastSeen.copy(playerPosition);
    if (this.state === "patrol" || this.state === "return") {
      this.state = "suspicious";
      this.alertTimer = 0;
    }
  }

  /** Damage from a player bullet. Returns the score the hit is worth. */
  damage(amount: number, playerPosition: THREE.Vector3): number {
    if (this.state === "dead") return 0;
    this.health -= amount;
    this.lastSeen.copy(playerPosition);
    if (this.health <= 0) {
      this.health = 0;
      this.state = "dead";
      this.deadTimer = 3.4;
      this.play(this.random() > 0.5 ? "DeathFront" : "DeathBack", true);
      return 300;
    }
    this.state = "engage";
    return 100;
  }

  private canSee(eye: THREE.Vector3): boolean {
    const origin = this.root.position.clone().setY(ENEMY_HEIGHT * 0.85);
    const toPlayer = eye.clone().sub(origin);
    const distance = toPlayer.length();
    if (distance > VIEW_RANGE) return false;
    toPlayer.divideScalar(distance);
    const facing = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const flat = toPlayer.clone().setY(0).normalize();
    if (this.state !== "engage" && facing.dot(flat) < Math.cos(VIEW_HALF_ANGLE)) return false;
    this.ray.set(origin, toPlayer);
    this.ray.far = distance - 0.3;
    const hits = this.ray.intersectObjects(this.world.occluders, false);
    return hits.length === 0;
  }

  update(dt: number, eye: THREE.Vector3, playerAlive: boolean, shots: EnemyShot[]): void {
    this.mixer?.update(dt);

    if (this.state === "dead") {
      this.deadTimer -= dt;
      if (this.deadTimer <= 0) this.reset();
      return;
    }

    const sees = playerAlive && this.canSee(eye);
    if (sees) {
      this.lastSeen.copy(eye);
      if (this.state !== "engage") {
        this.alertTimer += dt;
        if (this.alertTimer > 0.35 || this.state === "suspicious") this.state = "engage";
      }
    } else if (this.state === "engage") {
      this.state = "search";
      this.searchTimer = 4.5;
    }

    let speed = WALK_SPEED;
    const desired = new THREE.Vector3();

    if (this.state === "patrol" || this.state === "return") {
      const point = PATROL_ROUTE[this.waypoint % PATROL_ROUTE.length]!;
      this.target.set(point[0], 0, point[1]);
      desired.subVectors(this.target, this.root.position).setY(0);
      if (desired.length() < 0.6) {
        this.waypoint = (this.waypoint + 1) % PATROL_ROUTE.length;
        if (this.state === "return") this.state = "patrol";
      }
      this.play(desired.length() > 0.05 ? "RifleWalk" : "RifleIdle");
    } else if (this.state === "suspicious") {
      speed = CHASE_SPEED * 0.8;
      desired.subVectors(this.lastSeen, this.root.position).setY(0);
      if (desired.length() < 2.5) {
        this.state = "search";
        this.searchTimer = 3.5;
      }
      this.play("RifleWalk");
    } else if (this.state === "search") {
      this.searchTimer -= dt;
      speed = CHASE_SPEED * 0.7;
      desired.subVectors(this.lastSeen, this.root.position).setY(0);
      if (desired.length() < 1.5) desired.set(0, 0, 0);
      if (this.searchTimer <= 0) {
        this.state = "return";
      }
      this.play(desired.length() > 0.05 ? "RifleWalk" : "RifleIdle");
    } else {
      // engage: close to engagement range, strafe, fire bursts
      const toPlayer = new THREE.Vector3().subVectors(eye, this.root.position).setY(0);
      const distance = toPlayer.length();
      const forward = toPlayer.clone().normalize();
      const side = new THREE.Vector3(-forward.z, 0, forward.x);
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = 1.1 + this.random() * 1.3;
        this.strafe = this.random() > 0.5 ? 1 : -1;
      }
      speed = CHASE_SPEED;
      if (distance > ENGAGE_RANGE) desired.copy(forward).multiplyScalar(1.4);
      else if (distance < ENGAGE_RANGE * 0.55) desired.copy(forward).multiplyScalar(-1);
      desired.addScaledVector(side, this.strafe * 0.9);

      if (sees) {
        this.burstTimer -= dt;
        if (this.burstLeft > 0) {
          if (this.burstTimer <= 0) {
            this.burstLeft -= 1;
            this.burstTimer = this.burstLeft > 0 ? BURST_SPACING : BURST_COOLDOWN;
            // half the rounds in a burst connect; a connecting round costs 9 health
            if (this.random() < 0.5) {
              shots.push({
                damage: ROUND_DAMAGE,
                origin: this.root.position.clone().setY(ENEMY_HEIGHT * 0.8),
              });
            }
          }
        } else if (this.burstTimer <= 0) {
          this.burstLeft = BURST_ROUNDS;
          this.burstTimer = BURST_SPACING;
        }
        this.play(this.burstLeft > 0 ? "FiringRifle" : "RifleWalk");
      } else {
        this.play("RifleWalk");
      }
    }

    // move
    if (desired.lengthSq() > 1e-6) {
      desired.normalize().multiplyScalar(speed);
      this.velocity.lerp(desired, Math.min(1, dt * 8));
    } else {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 8));
    }
    this.root.position.addScaledVector(this.velocity, dt);
    resolveCollisions(this.world, this.root.position, 0.42, this.root.position.y);
    this.root.position.y = groundHeight(this.world, this.root.position.x, this.root.position.z, this.root.position.y);

    // face the way it walks, or the player while engaging
    let facingYaw = this.yaw;
    if (this.state === "engage") {
      facingYaw = Math.atan2(eye.x - this.root.position.x, eye.z - this.root.position.z);
    } else if (this.velocity.lengthSq() > 0.05) {
      facingYaw = Math.atan2(this.velocity.x, this.velocity.z);
    }
    let delta = facingYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * Math.min(1, dt * 7);
    this.root.rotation.y = this.yaw;
  }
}
