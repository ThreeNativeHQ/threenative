import { Group, PerspectiveCamera, Scene, Vector3 } from "three/webgpu";
import { animateFox, makeFox, type IFoxRig } from "./fox.js";
import { buildLevel, type ILevel, type IPlatform } from "./level.js";

export interface IGameState {
  jumps: number;
  peakRise: number;
  playerX: number;
  playerY: number;
  playerZ: number;
  coins: number;
  coinsTotal: number;
  goalReached: boolean;
  respawns: number;
  elapsed: number;
  lives: number;
}

const GRAVITY = 26;
const JUMP_SPEED = 11.6;
const RUN_SPEED = 7.4;
const ACCELERATION = 46;
const AIR_ACCELERATION = 22;
const FRICTION = 34;
const PLAYER_RADIUS = 0.34;
const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.16;
/** How far down a platform's side counts as solid wall. */
const WALL_DEPTH = 3.2;

export interface IGame {
  scene: Scene;
  camera: PerspectiveCamera;
  level: ILevel;
  player: Group;
  state: IGameState;
  tick: (deltaSeconds?: number) => void;
  restart: () => void;
  queueJump: () => void;
  input: Record<string, boolean>;
  entities: Array<{ id: string; object: Group }>;
}

interface IPlayerBody {
  position: Vector3;
  velocity: Vector3;
  grounded: boolean;
  facing: number;
  sinceGrounded: number;
  jumpBuffer: number;
  launchY: number;
  airborne: boolean;
  invulnerable: number;
}

function topSurfaceAt(platforms: IPlatform[], x: number, z: number, y: number): IPlatform | null {
  let best: IPlatform | null = null;
  for (const platform of platforms) {
    if (x < platform.minX - PLAYER_RADIUS || x > platform.maxX + PLAYER_RADIUS) continue;
    if (z < platform.minZ - PLAYER_RADIUS || z > platform.maxZ + PLAYER_RADIUS) continue;
    if (platform.top > y + 0.35) continue;
    if (!best || platform.top > best.top) best = platform;
  }
  return best;
}

export function createGame(): IGame {
  const scene = new Scene();
  const camera = new PerspectiveCamera(52, 16 / 9, 0.1, 400);
  const level = buildLevel(scene);

  const rig: IFoxRig = makeFox();
  scene.add(rig.root);

  const body: IPlayerBody = {
    position: new Vector3(level.spawn.x, level.spawn.y, level.spawn.z),
    velocity: new Vector3(),
    grounded: true,
    facing: Math.PI / 2,
    sinceGrounded: 0,
    jumpBuffer: 0,
    launchY: level.spawn.y,
    airborne: false,
    invulnerable: 0,
  };

  const state: IGameState = {
    jumps: 0,
    peakRise: 0,
    playerX: body.position.x,
    playerY: body.position.y,
    playerZ: body.position.z,
    coins: 0,
    coinsTotal: level.coins.length,
    goalReached: false,
    respawns: 0,
    elapsed: 0,
    lives: 3,
  };

  const input: Record<string, boolean> = {};
  let time = 0;
  const cameraTarget = new Vector3();
  const desiredCamera = new Vector3();

  // last safely-grounded spot, so a fall costs a life rather than the whole run
  const checkpoint = new Vector3(level.spawn.x, level.spawn.y, level.spawn.z);

  const respawn = (): void => {
    state.respawns += 1;
    state.lives = Math.max(0, state.lives - 1);
    body.position.set(checkpoint.x, checkpoint.y + 0.4, checkpoint.z);
    body.velocity.set(0, 0, 0);
    body.grounded = true;
    body.airborne = false;
    body.invulnerable = 0.8;
  };

  const restart = (): void => {
    state.jumps = 0;
    state.peakRise = 0;
    state.coins = 0;
    state.goalReached = false;
    state.respawns = 0;
    state.elapsed = 0;
    state.lives = 3;
    body.position.set(level.spawn.x, level.spawn.y, level.spawn.z);
    body.velocity.set(0, 0, 0);
    body.grounded = true;
    body.airborne = false;
    body.invulnerable = 0;
    for (const coin of level.coins) {
      coin.collected = false;
      coin.object.visible = true;
      coin.object.scale.setScalar(1);
    }
    for (const enemy of level.enemies) {
      enemy.x = enemy.minX;
      enemy.direction = 1;
      enemy.object.visible = true;
      enemy.object.scale.setScalar(1);
    }
  };

  const pressed = (...keys: string[]): boolean => keys.some((key) => input[key] === true);

  // A tap shorter than a frame must still jump: keydown queues a pulse the next tick consumes.
  // A held key must not auto-bounce, so only the rising edge counts.
  let queuedJump = false;
  let jumpHeld = false;
  const queueJump = (): void => {
    queuedJump = true;
  };

  const tick = (deltaSeconds = 1 / 60): void => {
    const dt = Math.min(0.05, Math.max(0.0005, deltaSeconds));
    time += dt;
    if (!state.goalReached) state.elapsed += dt;

    // --- intent ---
    let moveX = 0;
    let moveZ = 0;
    if (pressed("ArrowRight", "KeyD")) moveX += 1;
    if (pressed("ArrowLeft", "KeyA")) moveX -= 1;
    if (pressed("ArrowUp", "KeyW")) moveZ -= 1;
    if (pressed("ArrowDown", "KeyS")) moveZ += 1;
    const length = Math.hypot(moveX, moveZ);
    if (length > 1) {
      moveX /= length;
      moveZ /= length;
    }

    // --- horizontal movement ---
    const accel = body.grounded ? ACCELERATION : AIR_ACCELERATION;
    const targetX = moveX * RUN_SPEED;
    const targetZ = moveZ * RUN_SPEED * 0.75;
    if (moveX !== 0) {
      body.velocity.x += Math.sign(targetX - body.velocity.x) * accel * dt;
      if (Math.abs(body.velocity.x) > RUN_SPEED) body.velocity.x = Math.sign(body.velocity.x) * RUN_SPEED;
    } else {
      const drop = FRICTION * dt * (body.grounded ? 1 : 0.35);
      body.velocity.x -= Math.sign(body.velocity.x) * Math.min(Math.abs(body.velocity.x), drop);
    }
    if (moveZ !== 0) {
      body.velocity.z += Math.sign(targetZ - body.velocity.z) * accel * dt;
      if (Math.abs(body.velocity.z) > RUN_SPEED * 0.75) {
        body.velocity.z = Math.sign(body.velocity.z) * RUN_SPEED * 0.75;
      }
    } else {
      const drop = FRICTION * dt * (body.grounded ? 1 : 0.35);
      body.velocity.z -= Math.sign(body.velocity.z) * Math.min(Math.abs(body.velocity.z), drop);
    }

    // --- jump, with coyote time and an input buffer ---
    const spaceDown = pressed("Space");
    if ((spaceDown && !jumpHeld) || queuedJump) body.jumpBuffer = JUMP_BUFFER;
    else body.jumpBuffer = Math.max(0, body.jumpBuffer - dt);
    jumpHeld = spaceDown;
    queuedJump = false;
    if (body.jumpBuffer > 0 && (body.grounded || body.sinceGrounded < COYOTE_TIME)) {
      body.velocity.y = JUMP_SPEED;
      body.grounded = false;
      body.airborne = true;
      body.launchY = body.position.y;
      body.sinceGrounded = COYOTE_TIME;
      body.jumpBuffer = 0;
      state.jumps += 1;
    }

    // --- integrate ---
    body.velocity.y -= GRAVITY * dt;
    body.position.x += body.velocity.x * dt;
    body.position.z += body.velocity.z * dt;
    body.position.y += body.velocity.y * dt;

    if (body.airborne) {
      const rise = body.position.y - body.launchY;
      if (rise > state.peakRise) state.peakRise = rise;
    }

    // --- ground resolution ---
    const wasGrounded = body.grounded;
    body.grounded = false;
    const surface = topSurfaceAt(level.platforms, body.position.x, body.position.z, body.position.y);
    if (surface && body.velocity.y <= 0 && body.position.y <= surface.top + 0.02) {
      body.position.y = surface.top;
      body.velocity.y = 0;
      body.grounded = true;
      body.airborne = false;
      const clear =
        body.position.x > surface.minX + 0.9 &&
        body.position.x < surface.maxX - 0.9 &&
        body.position.z > surface.minZ + 0.6 &&
        body.position.z < surface.maxZ - 0.6;
      if (clear) checkpoint.copy(body.position);
    }
    // Cliff faces are solid: without this a jump that lands short passes straight through
    // the ledge and drops into the void behind it.
    if (!body.grounded) {
      for (const platform of level.platforms) {
        const belowTop = body.position.y < platform.top - 0.08;
        const aboveFace = body.position.y > platform.top - WALL_DEPTH;
        if (!belowTop || !aboveFace) continue;
        if (
          body.position.x < platform.minX - PLAYER_RADIUS ||
          body.position.x > platform.maxX + PLAYER_RADIUS ||
          body.position.z < platform.minZ - PLAYER_RADIUS ||
          body.position.z > platform.maxZ + PLAYER_RADIUS
        ) {
          continue;
        }
        const pushLeft = body.position.x - (platform.minX - PLAYER_RADIUS);
        const pushRight = platform.maxX + PLAYER_RADIUS - body.position.x;
        const pushBack = body.position.z - (platform.minZ - PLAYER_RADIUS);
        const pushFront = platform.maxZ + PLAYER_RADIUS - body.position.z;
        const smallest = Math.min(pushLeft, pushRight, pushBack, pushFront);
        if (smallest === pushLeft) {
          body.position.x = platform.minX - PLAYER_RADIUS;
          body.velocity.x = Math.min(0, body.velocity.x);
        } else if (smallest === pushRight) {
          body.position.x = platform.maxX + PLAYER_RADIUS;
          body.velocity.x = Math.max(0, body.velocity.x);
        } else if (smallest === pushBack) {
          body.position.z = platform.minZ - PLAYER_RADIUS;
          body.velocity.z = Math.min(0, body.velocity.z);
        } else {
          body.position.z = platform.maxZ + PLAYER_RADIUS;
          body.velocity.z = Math.max(0, body.velocity.z);
        }
      }
    }

    body.sinceGrounded = body.grounded ? 0 : body.sinceGrounded + dt;
    if (wasGrounded && !body.grounded && !body.airborne) body.launchY = body.position.y;
    if (!body.grounded && !body.airborne) {
      body.airborne = true;
      body.launchY = Math.max(body.launchY, body.position.y);
    }

    if (body.position.y < level.killY) respawn();
    body.invulnerable = Math.max(0, body.invulnerable - dt);

    // --- enemies ---
    for (const enemy of level.enemies) {
      if (!enemy.object.visible) continue;
      enemy.x += enemy.direction * enemy.speed * dt;
      if (enemy.x > enemy.maxX) {
        enemy.x = enemy.maxX;
        enemy.direction = -1;
      } else if (enemy.x < enemy.minX) {
        enemy.x = enemy.minX;
        enemy.direction = 1;
      }
      enemy.object.position.set(enemy.x, enemy.y + Math.abs(Math.sin(time * 6)) * 0.06, enemy.z);
      enemy.object.rotation.y = enemy.direction > 0 ? Math.PI / 2 : -Math.PI / 2;

      const dx = body.position.x - enemy.x;
      const dz = body.position.z - enemy.z;
      const dy = body.position.y - enemy.y;
      if (Math.hypot(dx, dz) < 0.85 && dy < 1.15 && dy > -0.8) {
        if (body.velocity.y < -1 && dy > 0.55) {
          // stomp: squash the walker and bounce
          enemy.object.visible = false;
          body.velocity.y = JUMP_SPEED * 0.62;
          body.airborne = true;
          body.launchY = body.position.y;
        } else if (body.invulnerable <= 0) {
          respawn();
        }
      }
    }

    // --- coins ---
    for (const coin of level.coins) {
      if (coin.collected) continue;
      coin.object.rotation.y = Math.sin(time * 2.2 + coin.x * 0.6) * 0.55;
      coin.object.position.y = coin.y + Math.sin(time * 2.6 + coin.x) * 0.09;
      if (
        Math.hypot(body.position.x - coin.x, body.position.z - coin.z) < 0.95 &&
        Math.abs(body.position.y + 0.7 - coin.object.position.y) < 1.15
      ) {
        coin.collected = true;
        coin.object.visible = false;
        state.coins += 1;
      }
    }

    // --- goal ---
    level.goalStar.rotation.y += dt * 1.6;
    level.windmillSails.rotation.z += dt * 0.55;
    if (
      !state.goalReached &&
      Math.hypot(body.position.x - level.goal.x, body.position.z - level.goal.z) < level.goal.radius &&
      Math.abs(body.position.y - level.goal.y) < 2.6
    ) {
      state.goalReached = true;
    }

    // --- present the player ---
    if (Math.abs(body.velocity.x) > 0.3 || Math.abs(body.velocity.z) > 0.3) {
      body.facing = Math.atan2(body.velocity.x, -body.velocity.z);
    }
    rig.root.position.copy(body.position);
    rig.root.rotation.y = body.facing;
    animateFox(rig, time, Math.hypot(body.velocity.x, body.velocity.z), body.grounded, body.velocity.y);

    // --- camera: behind, above, damped ---
    desiredCamera.set(body.position.x - 2.9, body.position.y + 2.85, body.position.z + 7.5);
    const follow = 1 - Math.exp(-6.5 * dt);
    camera.position.lerp(desiredCamera, follow);
    cameraTarget.set(body.position.x + 2.1, body.position.y + 1.45, body.position.z - 1.2);
    camera.lookAt(cameraTarget);

    state.playerX = body.position.x;
    state.playerY = body.position.y;
    state.playerZ = body.position.z;
  };

  // seat the camera before the first frame so screenshots are never mid-lerp
  camera.position.set(level.spawn.x - 2.9, level.spawn.y + 2.85, level.spawn.z + 7.5);
  camera.lookAt(level.spawn.x + 2.1, level.spawn.y + 1.45, level.spawn.z - 1.2);

  const entities: Array<{ id: string; object: Group }> = [{ id: "player", object: rig.root }];
  for (const [index, enemy] of level.enemies.entries()) {
    entities.push({ id: `enemy${index}`, object: enemy.object });
  }
  for (const [index, coin] of level.coins.entries()) {
    entities.push({ id: `coin${index}`, object: coin.object });
  }
  entities.push({ id: "goal", object: level.goalGroup });

  return {
    scene,
    camera,
    level,
    player: rig.root,
    state,
    tick,
    restart,
    queueJump,
    input,
    entities,
  };
}
