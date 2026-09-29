// The whole game's rules in one deterministic class: no three, no DOM, no clock of its own, no
// random. `update(dt, input)` is the only thing that moves time, so a scripted run replays to the
// same numbers every time and a playtest can call anything here without a browser.
//
// Everything the player sees happen — a hit, a pickup, a heart lost — leaves as an entry in
// `events`, which the scene drains once a frame to make sparks, sounds and toasts. The rules never
// draw and the renderer never decides.
import {
  ALTAR,
  CHEST,
  ENEMIES,
  GEMS,
  type ILayout,
  KEEPER,
  POTS,
  SIGIL_SITES,
  createLayout,
} from "./layout.js";
import { type IObstacle, type IPoint, moveDirection, moveWithCollisions, spendStamina } from "./movement.js";
import {
  type ISave,
  MAX_HP,
  SIGILS,
  type SigilId,
  activateAltar,
  collectSigil,
  meetKeeper,
  newGame,
} from "./quest.js";
import { clamp, floorHeight, groundHeight } from "./terrain.js";

export type EnemyMode = "chase" | "hurt" | "idle" | "recover" | "return" | "windup";

export interface IPlayer {
  angle: number;
  attack: number;
  attackCooldown: number;
  blocking: boolean;
  dead: number;
  invuln: number;
  regenDelay: number;
  roll: number;
  rollX: number;
  rollZ: number;
  speed: number;
  stamina: number;
  vy: number;
  walk: number;
  x: number;
  y: number;
  z: number;
}

export interface IEnemy {
  attackHit: boolean;
  dead: boolean;
  readonly homeX: number;
  readonly homeZ: number;
  readonly id: number;
  hit: number;
  hp: number;
  mode: EnemyMode;
  timer: number;
  x: number;
  y: number;
  z: number;
}

export interface IPot {
  broken: boolean;
  readonly id: number;
  readonly x: number;
  readonly z: number;
}

export interface IGem {
  readonly baseY: number;
  readonly phase: number;
  readonly value: number;
  readonly x: number;
  readonly z: number;
}

/** What the player asked for this frame. Edges (`attack`, `dodge`, `interact`, `lock`) are presses. */
export interface IInput {
  attack: boolean;
  block: boolean;
  dodge: boolean;
  forward: number;
  interact: boolean;
  lock: boolean;
  right: number;
  sprint: boolean;
  /** The camera's orbit angle: forward is away from it. */
  yaw: number;
}

export const NO_INPUT: Readonly<IInput> = {
  attack: false, block: false, dodge: false, forward: 0, interact: false, lock: false, right: 0, sprint: false, yaw: 0,
};

export type IEvent =
  | { kind: "altar"; x: number; y: number; z: number }
  | { kind: "attack" }
  | { kind: "block" | "gem" | "hurt" | "potBreak"; x: number; y: number; z: number }
  | { kind: "chest"; x: number; y: number; z: number }
  | { kind: "dead" | "respawn" | "roll" }
  | { kind: "enemyDown" | "enemyHit"; x: number; y: number; z: number }
  | { kind: "sigil"; x: number; y: number; z: number; id: SigilId }
  | { kind: "toast"; seconds: number; text: string };

export interface IInteraction {
  readonly kind: "altar" | "chest" | "npc" | "sigil";
  readonly label: string;
  readonly id?: SigilId;
  readonly x: number;
  readonly z: number;
}

export const SPAWN = { angle: Math.PI, x: 0, z: 12 } as const;
const HURT_INVULN = 1.25;
const ATTACK_TIME = 0.46;
const ROLL_TIME = 0.58;

/** The keeper's lines: a story stage in, a page of dialogue out. */
function keeperLines(stage: ISave["stage"], found: number): readonly string[] {
  if (stage === "meet")
    return [
      "There you are, little wanderer. The elder grove has gone quiet. Three of its lights have scattered into the woods.",
      "One rests by the brook, one beyond the eastern briars, and one beneath the old trees to the northwest. Your map remembers their places.",
      "Bring all three to the stone altar in the north. Watch for briarlings: strike with J, roll with Space, or hold K to raise your shield. I will be here.",
    ];
  if (stage === "seek")
    return [
      `You have found ${found} of the three lights. Look for the diamond marks on your map. The brook is west, the briars east, and the elder trees northwest.`,
      "You need not fight every creature. A well-timed roll will carry you through danger. That old chest near the elder tree might help, too.",
    ];
  if (stage === "altar")
    return ["All three lights, at last. Follow the stone path north, beyond the great stair, to the ancient altar. The grove is waiting."];
  return ["Listen. The birds have returned. A forest never forgets the ones who care for it. Stay as long as you like, little wanderer."];
}

const ALTAR_LOCKED = ["Three empty markings circle the stone. Something living sleeps beneath it. Bring the three woodland sigils here to awaken the grove."];

export class Adventure {
  readonly layout: ILayout;
  save: ISave = newGame();
  readonly player: IPlayer = freshPlayer();
  readonly enemies: IEnemy[] = [];
  readonly pots: IPot[] = [];
  gems: IGem[] = [];
  chestOpened = false;
  /** The lines being read, or none. While it is set the world holds still. */
  dialog: { index: number; lines: readonly string[] } | undefined;
  /** True from the altar's awakening until the player chooses to stay. */
  victory = false;
  lock: IEnemy | undefined;
  time = 0;
  readonly events: IEvent[] = [];
  readonly stats = { attacks: 0, damageTaken: 0, interactions: 0, kills: 0, rolls: 0 };
  #timers: { at: number; fn: () => void }[] = [];
  #hit = new Set<object>();
  #scratch: IPoint = { x: 0, z: 0 };
  #walk: IPoint = { x: 0, z: 0 };
  #obstacles: readonly IObstacle[];

  constructor(options: { layout?: ILayout; save?: ISave } = {}) {
    this.layout = options.layout ?? createLayout();
    this.#obstacles = this.layout.obstacles;
    if (options.save !== undefined) this.save = options.save;
    this.#populate();
  }

  /** A new adventure: save, hero, enemies, pots and gems back to their first state. */
  reset(): void {
    this.save = newGame();
    Object.assign(this.player, freshPlayer());
    this.chestOpened = false;
    this.dialog = undefined;
    this.victory = false;
    this.lock = undefined;
    this.#timers.length = 0;
    this.#hit.clear();
    this.events.length = 0;
    this.#populate();
    this.toast("A new path begins.", 3);
  }

  #populate(): void {
    this.enemies.length = 0;
    ENEMIES.forEach(([x, z], id) => {
      this.enemies.push({ attackHit: false, dead: false, hit: 0, hp: 3, homeX: x, homeZ: z, id, mode: "idle", timer: (id * 0.37) % 2, x, y: groundHeight(x, z), z });
    });
    this.pots.length = 0;
    POTS.forEach(([x, z], id) => this.pots.push({ broken: false, id, x, z }));
    this.gems = [];
    for (const [x, z] of GEMS) this.addGem(x, z, 1);
    this.chestOpened = this.save.openedChests.includes("oak");
    this.player.y = groundHeight(SPAWN.x, SPAWN.z);
  }

  addGem(x: number, z: number, value: number): void {
    this.gems.push({ baseY: groundHeight(x, z) + 0.6, phase: (this.gems.length * 2.399) % (Math.PI * 2), value, x, z });
  }

  toast(text: string, seconds = 3): void {
    this.events.push({ kind: "toast", seconds, text });
  }

  /** Moves the hero somewhere without a fall: a playtest's and a respawn's way in. */
  teleport(x: number, z: number, angle = Math.PI): void {
    Object.assign(this.player, { angle, vy: 0, x, y: groundHeight(x, z), z });
    this.player.invuln = 1;
  }

  /** The nearest thing the hero can act on right now. */
  interaction(): IInteraction | undefined {
    const p = this.player;
    const list: IInteraction[] = [{ kind: "npc", label: "Talk to Mira", x: KEEPER.x, z: KEEPER.z }];
    for (const id of SIGILS) {
      if (this.save.sigils.includes(id)) continue;
      const site = SIGIL_SITES[id];
      list.push({ id, kind: "sigil", label: `Take the ${site.name.toLowerCase()}`, x: site.x, z: site.z });
    }
    list.push({ kind: "altar", label: this.save.stage === "altar" ? "Awaken the grove" : "Examine the altar", x: ALTAR.x, z: ALTAR.z });
    if (!this.chestOpened) list.push({ kind: "chest", label: "Open the old chest", x: CHEST.x, z: CHEST.z });
    const reach = { altar: 2.5, chest: 2, npc: 2.5, sigil: 1.95 } as const;
    let best: IInteraction | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of list) {
      const d = Math.hypot(item.x - p.x, item.z - p.z);
      if (d >= reach[item.kind] || Math.abs(groundHeight(item.x, item.z) - p.y) >= 1.5 || d >= bestDistance) continue;
      best = item;
      bestDistance = d;
    }
    return best;
  }

  /** The enemy the lock-on would pick, or none within 10 m. */
  nearestEnemy(): IEnemy | undefined {
    let best: IEnemy | undefined;
    let bestDistance = 10;
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - this.player.x, e.z - this.player.z);
      if (!e.dead && d < bestDistance) {
        best = e;
        bestDistance = d;
      }
    }
    return best;
  }

  advanceDialog(): void {
    if (this.dialog === undefined) return;
    this.dialog.index += 1;
    if (this.dialog.index >= this.dialog.lines.length) this.dialog = undefined;
  }

  closeDialog(): void {
    this.dialog = undefined;
  }

  #later(seconds: number, fn: () => void): void {
    this.#timers.push({ at: this.time + seconds, fn });
  }

  #say(lines: readonly string[]): void {
    this.dialog = { index: 0, lines };
    this.player.blocking = false;
  }

  /** One fixed step. */
  update(dt: number, input: Readonly<IInput> = NO_INPUT): void {
    this.time += dt;
    for (let i = this.#timers.length - 1; i >= 0; i -= 1) {
      const timer = this.#timers[i];
      if (timer !== undefined && this.time >= timer.at) {
        this.#timers.splice(i, 1);
        timer.fn();
      }
    }
    if (input.interact && !this.victory) {
      if (this.dialog === undefined) this.#interact();
      else this.advanceDialog();
    }
    if (this.dialog !== undefined || this.victory) {
      this.#settle();
      return;
    }
    if (input.lock) {
      this.lock = this.lock === undefined ? this.nearestEnemy() : undefined;
      if (this.lock === undefined) this.toast("No target locked.", 1.2);
    }
    if (input.attack) this.#attack();
    if (input.dodge) this.#dodge(input);
    this.#updatePlayer(dt, input);
    this.#updateEnemies(dt);
  }

  #settle(): void {
    this.player.blocking = false;
    this.player.speed = 0;
  }

  #attack(): void {
    const p = this.player;
    if (p.dead > 0 || p.attackCooldown > 0 || p.roll > 0) return;
    p.attack = ATTACK_TIME;
    p.attackCooldown = 0.51;
    p.blocking = false;
    this.#hit = new Set();
    this.stats.attacks += 1;
    this.events.push({ kind: "attack" });
  }

  #dodge(input: Readonly<IInput>): void {
    const p = this.player;
    if (p.dead > 0 || p.roll > 0) return;
    if (!spendStamina(p, 24)) {
      this.toast("Catch your breath.", 1.4);
      return;
    }
    const d = moveDirection(input.right, input.forward, input.yaw, this.#walk);
    const magnitude = Math.hypot(d.x, d.z);
    p.rollX = magnitude > 0.1 ? d.x : Math.sin(p.angle);
    p.rollZ = magnitude > 0.1 ? d.z : Math.cos(p.angle);
    p.angle = Math.atan2(p.rollX, p.rollZ);
    p.roll = ROLL_TIME;
    p.invuln = Math.max(p.invuln, 0.5);
    p.regenDelay = 0.85;
    p.attack = 0;
    this.stats.rolls += 1;
    this.events.push({ kind: "roll" });
  }

  #interact(): void {
    const p = this.player;
    if (p.dead > 0) return;
    const target = this.interaction();
    if (target === undefined) return;
    this.stats.interactions += 1;
    const save = this.save;
    if (target.kind === "npc") {
      const found = save.sigils.length;
      const stage = save.stage;
      meetKeeper(save);
      this.#say(keeperLines(stage, found));
      return;
    }
    if (target.kind === "sigil" && target.id !== undefined) {
      if (save.stage === "meet") {
        this.toast("Mira knows the story of these lights. Find her by the stair.");
        return;
      }
      if (!collectSigil(save, target.id)) return;
      const y = groundHeight(target.x, target.z) + 1;
      this.events.push({ id: target.id, kind: "sigil", x: target.x, y, z: target.z });
      this.toast(`${SIGIL_SITES[target.id].name} found  ·  ${save.sigils.length} / 3`, 3.2);
      if (save.stage === "altar") this.#later(3.3, () => this.toast("The altar is calling. Follow the northern path.", 4));
      return;
    }
    if (target.kind === "chest") {
      this.chestOpened = true;
      save.openedChests = ["oak"];
      save.gems = clamp(save.gems + 20, 0, 999);
      save.hp = MAX_HP;
      this.events.push({ kind: "chest", x: target.x, y: groundHeight(target.x, target.z) + 0.6, z: target.z });
      this.toast("A woodland gift  ·  +20 gems  ·  Hearts restored", 4);
      return;
    }
    if (activateAltar(save)) {
      p.invuln = 10;
      save.hp = MAX_HP;
      this.events.push({ kind: "altar", x: target.x, y: groundHeight(target.x, target.z) + 1.3, z: target.z });
      this.#later(1.2, () => {
        this.victory = true;
      });
    } else if (save.stage === "complete") this.toast("The roots are alive with a quiet, familiar song.", 4);
    else this.#say(ALTAR_LOCKED);
  }

  /** Damage from `enemy` (or from a fall, when none). Returns whether it landed. */
  hurt(amount: number, enemy?: IEnemy): boolean {
    const p = this.player;
    if (p.invuln > 0 || p.dead > 0) return false;
    const dx = enemy ? enemy.x - p.x : 0;
    const dz = enemy ? enemy.z - p.z : 1;
    const d = Math.hypot(dx, dz);
    const facing = d > 0 ? (Math.sin(p.angle) * dx + Math.cos(p.angle) * dz) / d : 1;
    if (p.blocking && facing > -0.1 && spendStamina(p, 15)) {
      p.invuln = 0.24;
      p.regenDelay = 0.7;
      this.events.push({ kind: "block", x: p.x, y: p.y + 1, z: p.z });
      this.toast("Blocked", 0.9);
      if (enemy) {
        enemy.x -= (dx / (d || 1)) * 0.6;
        enemy.z -= (dz / (d || 1)) * 0.6;
      }
      return false;
    }
    this.save.hp = Math.max(0, this.save.hp - amount);
    this.stats.damageTaken += amount;
    p.invuln = HURT_INVULN;
    p.regenDelay = 0.5;
    this.events.push({ kind: "hurt", x: p.x, y: p.y + 1, z: p.z });
    if (enemy && d > 0) {
      const moved = moveWithCollisions(p, (-dx / d) * 0.42, (-dz / d) * 0.42, this.#obstacles, 0.34, this.#scratch);
      p.x = moved.x;
      p.z = moved.z;
    }
    if (this.save.hp <= 0) {
      p.dead = 2.5;
      p.attack = 0;
      p.roll = 0;
      this.lock = undefined;
      this.events.push({ kind: "dead" });
      this.toast("Your fairy is bringing you home…", 3);
    }
    return true;
  }

  #strike(): void {
    const p = this.player;
    const fx = Math.sin(p.angle);
    const fz = Math.cos(p.angle);
    for (const e of this.enemies) {
      if (e.dead || this.#hit.has(e)) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2.15 && (d < 0.55 || (dx * fx + dz * fz) / d > -0.05) && Math.abs(e.y - p.y) < 1.6) {
        this.#hit.add(e);
        e.hp -= 1;
        e.hit = 0.25;
        e.mode = "hurt";
        e.timer = 0.4;
        this.events.push({ kind: "enemyHit", x: e.x, y: e.y + 0.65, z: e.z });
        const moved = moveWithCollisions(e, (dx / (d || 1)) * 0.52, (dz / (d || 1)) * 0.52, this.#obstacles, 0.35, this.#scratch);
        e.x = moved.x;
        e.z = moved.z;
        if (e.hp <= 0) {
          e.dead = true;
          this.stats.kills += 1;
          this.addGem(e.x, e.z, 3);
          this.events.push({ kind: "enemyDown", x: e.x, y: e.y + 0.5, z: e.z });
          if (this.lock === e) this.lock = undefined;
        }
      }
    }
    for (const pot of this.pots) {
      if (pot.broken || this.#hit.has(pot)) continue;
      const dx = pot.x - p.x;
      const dz = pot.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 2 && (d < 0.5 || (dx * fx + dz * fz) / d > 0)) {
        pot.broken = true;
        this.#hit.add(pot);
        this.addGem(pot.x, pot.z, 2);
        this.events.push({ kind: "potBreak", x: pot.x, y: groundHeight(pot.x, pot.z) + 0.3, z: pot.z });
      }
    }
  }

  #updatePlayer(dt: number, input: Readonly<IInput>): void {
    const p = this.player;
    if (p.dead > 0) {
      p.dead -= dt;
      if (p.dead <= 0) {
        p.dead = 0;
        p.attackCooldown = 0;
        p.x = SPAWN.x;
        p.z = SPAWN.z;
        p.y = groundHeight(SPAWN.x, SPAWN.z);
        p.vy = 0;
        this.save.hp = MAX_HP;
        this.save.gems = Math.max(0, this.save.gems - 5);
        p.stamina = 100;
        p.invuln = 2.5;
        for (const e of this.enemies) {
          e.x = e.homeX;
          e.z = e.homeZ;
          e.mode = "idle";
        }
        this.events.push({ kind: "respawn" });
        this.toast("A new breath  ·  5 gems offered to the forest", 3);
      }
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);
    p.regenDelay = Math.max(0, p.regenDelay - dt);
    p.blocking = input.block && p.stamina > 4 && p.roll === 0 && p.attack === 0;
    const d = moveDirection(input.right, input.forward, input.yaw, this.#walk);
    const mag = Math.hypot(d.x, d.z);
    let speed = 3.65;
    if (input.sprint && mag > 0.1 && p.stamina > 1 && p.roll === 0) {
      speed = 5.9;
      p.stamina = Math.max(0, p.stamina - dt * 18);
      p.regenDelay = 0.5;
    }
    if (p.blocking) speed = 1.65;
    if (p.attack > 0) speed *= 0.48;
    if (p.y < -0.5) speed *= 0.65;
    let vx = d.x * speed;
    let vz = d.z * speed;
    if (p.roll > 0) {
      p.roll = Math.max(0, p.roll - dt);
      const q = 1 - p.roll / ROLL_TIME;
      vx = p.rollX * (6.6 - 1.7 * q);
      vz = p.rollZ * (6.6 - 1.7 * q);
    }
    if (mag > 0.05 && p.roll === 0 && this.lock === undefined) p.angle = turnToward(p.angle, Math.atan2(d.x, d.z), 1 - Math.exp(-dt * 13));
    const lock = this.lock;
    if (lock !== undefined && !lock.dead) {
      const dx = lock.x - p.x;
      const dz = lock.z - p.z;
      p.angle = turnToward(p.angle, Math.atan2(dx, dz), 1 - Math.exp(-dt * 12));
      if (Math.hypot(dx, dz) > 14) this.lock = undefined;
    }
    const moved = moveWithCollisions(p, vx * dt, vz * dt, this.#obstacles, 0.32, this.#scratch);
    // A rise of more than two-thirds of a metre in one step is a cliff face, not a step.
    if (floorHeight(moved.x, moved.z, p.y) - p.y < 0.67 || p.vy > 0) {
      p.x = moved.x;
      p.z = moved.z;
    }
    const floor = floorHeight(p.x, p.z, p.y);
    if (p.y < floor + 0.1) {
      p.y = floor;
      p.vy = 0;
    } else {
      p.vy -= dt * 13;
      p.y += p.vy * dt;
      if (p.y <= floor) {
        if (p.vy < -10.5) this.hurt(1);
        p.y = floor;
        p.vy = 0;
      }
    }
    if (p.regenDelay <= 0 && !p.blocking && p.roll === 0) p.stamina = Math.min(100, p.stamina + dt * 24);
    p.speed = Math.hypot(vx, vz);
    p.walk += dt * p.speed * 2.8;
    if (p.attack > 0) {
      p.attack = Math.max(0, p.attack - dt);
      const progress = 1 - p.attack / ATTACK_TIME;
      if (progress > 0.15 && progress < 0.66) this.#strike();
    }
    const gems = this.gems;
    for (let i = gems.length - 1; i >= 0; i -= 1) {
      const g = gems[i] as IGem;
      if (Math.hypot(p.x - g.x, p.z - g.z) < 0.86 && Math.abs(p.y + 0.6 - g.baseY) < 1.3) {
        this.save.gems = clamp(this.save.gems + g.value, 0, 999);
        this.events.push({ kind: "gem", x: g.x, y: g.baseY, z: g.z });
        gems.splice(i, 1);
      }
    }
  }

  #updateEnemies(dt: number): void {
    const p = this.player;
    const peaceful = this.save.stage === "complete" || p.dead > 0;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d = Math.hypot(dx, dz);
      e.hit = Math.max(0, e.hit - dt);
      e.timer -= dt;
      if (peaceful) e.mode = "idle";
      if (e.mode === "idle") {
        if (d < 7 && !peaceful) e.mode = "chase";
      } else if (e.mode === "hurt") {
        if (e.timer <= 0) e.mode = "chase";
      } else if (e.mode === "chase") {
        if (d > 11 || Math.hypot(e.x - e.homeX, e.z - e.homeZ) > 10) e.mode = "return";
        else if (d < 1.32 && Math.abs(e.y - p.y) < 0.85) {
          e.mode = "windup";
          e.timer = 0.65;
          e.attackHit = false;
        } else if (d > 0.2) this.#shove(e, (dx / d) * 1.25 * dt, (dz / d) * 1.25 * dt);
      } else if (e.mode === "return") {
        const hx = e.homeX - e.x;
        const hz = e.homeZ - e.z;
        const hd = Math.hypot(hx, hz);
        if (hd < 0.5) e.mode = "idle";
        else this.#shove(e, (hx / hd) * dt, (hz / hd) * dt);
      } else if (e.mode === "windup") {
        if (e.timer <= 0) {
          if (d < 1.95 && Math.abs(e.y - p.y) < 1.1) this.hurt(2, e);
          e.mode = "recover";
          e.timer = 0.95;
        }
      } else if (e.mode === "recover" && e.timer <= 0) e.mode = "chase";
      e.y = groundHeight(e.x, e.z);
    }
  }

  #shove(e: IEnemy, dx: number, dz: number): void {
    const moved = moveWithCollisions(e, dx, dz, this.#obstacles, 0.35, this.#scratch);
    e.x = moved.x;
    e.z = moved.z;
  }
}

function freshPlayer(): IPlayer {
  return {
    angle: SPAWN.angle, attack: 0, attackCooldown: 0, blocking: false, dead: 0, invuln: 0, regenDelay: 0,
    roll: 0, rollX: 0, rollZ: -1, speed: 0, stamina: 100, vy: 0, walk: 0, x: SPAWN.x,
    y: groundHeight(SPAWN.x, SPAWN.z), z: SPAWN.z,
  };
}

/** Shortest-arc interpolation between two headings. */
export function turnToward(from: number, to: number, t: number): number {
  return from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
}
