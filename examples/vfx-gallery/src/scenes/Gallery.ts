import { GPUParticles3D, type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  BoxGeometry,
  Color,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from "three";
import {
  createBurstFlash,
  createEffekseerHit01,
  createEffekseerHit02,
  createEmberFountain,
  createImpactSparks,
  createMuzzleFlash,
  createSparkStreaks,
} from "../render/combat.js";
import {
  createGodotBloodSplash,
  createGodotFireflies,
  createGodotShieldBreak,
  createGodotWaterfallMist,
  createKenneyConfettiBurst,
  createKenneyLeafSwirl,
  createKenneySlashArc,
  createPixiBubbleStream,
  createPixiCartoonSmokeBlast,
} from "../render/extras.js";
import {
  createAshPlume,
  createDustCloud,
  createEffekseerWind01,
  createEffekseerWind02,
  createEffekseerWind03,
  createExplosionCloud,
  createFire,
  createGroundMist,
  createImpactDust,
  createJetFlame,
  createPoisonCloud,
  createRain,
  createSmoke,
  createSnow,
  createSteamPlume,
} from "../render/fireSmokeWeather.js";
import {
  createEffekseerFire01,
  createEffekseerFire02,
  createEffekseerFire03,
  createEffekseerHoly01,
  createEffekseerIce01,
  createEffekseerIce02,
  createEffekseerIce03,
  createEffekseerLightning01,
  createEffekseerLightning02,
  createEffekseerLightning03,
  createHealingAura,
  createMagicBeam,
  createMagicOrb,
  createMagicWisp,
} from "../render/magic.js";
import { type IPortalVortex, createPortalVortex } from "../render/portalVortex.js";

const EFFECT_IDS = [
  "fire",
  "jet-flame",
  "burst-flash",
  "muzzle-flash",
  "smoke",
  "dust-cloud",
  "steam-plume",
  "ash-plume",
  "explosion-cloud",
  "impact-dust",
  "ground-mist",
  "poison-cloud",
  "rain",
  "snow",
  "spark-streaks",
  "impact-sparks",
  "ember-fountain",
  "magic-wisp",
  "magic-orb",
  "magic-beam",
  "healing-aura",
  "effekseer-fire01",
  "effekseer-fire02",
  "effekseer-fire03",
  "effekseer-lightning01",
  "effekseer-lightning02",
  "effekseer-lightning03",
  "effekseer-ice01",
  "effekseer-ice02",
  "effekseer-ice03",
  "effekseer-holy01",
  "effekseer-hit01",
  "effekseer-hit02",
  "effekseer-wind01",
  "effekseer-wind02",
  "effekseer-wind03",
  "kenney-slash-arc",
  "kenney-confetti-burst",
  "kenney-leaf-swirl",
  "pixi-bubble-stream",
  "pixi-cartoon-smoke-blast",
  "godot-fireflies",
  "godot-portal-vortex",
  "godot-blood-splash",
  "godot-shield-break",
  "godot-waterfall-mist",
] as const;

export const EFFECT_LABELS = [
  { name: "Fire", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Jet Flame", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Burst Flash", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Muzzle Flash", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Smoke", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Dust Cloud", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Steam Plume", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Ash Plume", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Explosion Cloud", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Impact Dust", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Ground Mist", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Poison Cloud", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Rain", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Snow", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Spark Streaks", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Impact Sparks", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Ember Fountain", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Magic Wisp", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Magic Orb", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Magic Beam", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Healing Aura", group: "webgpu-vfx", credit: "MIT PARAMETER PORT" },
  { name: "Effekseer Fire 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Fire 02", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Fire 03", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Lightning 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Lightning 02", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Lightning 03", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Ice 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Ice 02", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Ice 03", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Holy 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Hit 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Hit 02", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Wind 01", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Wind 02", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Effekseer Wind 03", group: "Effekseer", credit: "CC0 FAMILY RECREATION" },
  { name: "Kenney Slash Arc", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Kenney Confetti Burst", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Kenney Leaf Swirl", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Pixi Bubble Stream", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Pixi Cartoon Smoke Blast", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Godot Fireflies", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Godot Portal Vortex", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Godot Blood Splash", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Godot Shield Break", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
  { name: "Godot Waterfall Mist", group: "extras", credit: "SOURCE-GUIDED RECREATION" },
] as const;

const PAGE_SIZE = 9;
const PAGE_COUNT = Math.ceil(EFFECT_IDS.length / PAGE_SIZE);
const COLUMN_COUNT = 3;
const COLUMN_WIDTH = 4;
const ROW_DEPTH = 3.2;

export type GalleryState = {
  readonly appliedIds: readonly string[];
  readonly evaluatedTiles: number;
  readonly missingTiles: readonly string[];
  readonly page: number;
  readonly pagesVisited: number;
  readonly burstCommands: number;
  readonly gpuCapacity: number;
  readonly portalRingDispatches: number;
  readonly portalRibbonDispatches: number;
};

type GalleryCtx = ICtx<GalleryState>;

const initialState: GalleryState = {
  appliedIds: [],
  evaluatedTiles: 0,
  missingTiles: [...EFFECT_IDS],
  page: 0,
  pagesVisited: 1,
  burstCommands: 0,
  gpuCapacity: 0,
  portalRingDispatches: 0,
  portalRibbonDispatches: 0,
};

type GalleryEvent = { readonly [key: string]: string | number };
const events: GalleryEvent[] = [];

export function drainGalleryEvents(): GalleryEvent[] {
  return events.splice(0, events.length);
}

class GalleryEffectEntity {
  readonly mesh: Object3D;
  readonly objects: readonly Object3D[];
  readonly effectId: string;
  readonly page: number;
  readonly spawnCommands: number;
  readonly gpuCapacity: number;

  constructor(
    objects: readonly Object3D[],
    effectId: string,
    page: number,
    gpuCapacity: number,
    spawnCommands = 1,
  ) {
    const mesh = objects[0];
    if (mesh === undefined) throw new Error(`VFX gallery effect has no objects: ${effectId}`);
    this.mesh = mesh;
    this.objects = objects;
    this.effectId = effectId;
    this.page = page;
    this.gpuCapacity = gpuCapacity;
    this.spawnCommands = spawnCommands;
  }

  setVisible(page: number): void {
    const visible = page === this.page;
    for (const object of this.objects) {
      object.visible = visible;
      if (object instanceof GPUParticles3D) object.emitting = visible;
    }
  }

  debug(): Record<string, unknown> {
    return {
      effectId: this.effectId,
      gpuCapacity: this.gpuCapacity,
      spawnCommands: this.spawnCommands,
      evaluated: true,
    };
  }
}

function tilePosition(index: number): Vector3 {
  const slot = index % PAGE_SIZE;
  const column = slot % COLUMN_COUNT;
  const row = Math.floor(slot / COLUMN_COUNT);
  return new Vector3((column - (COLUMN_COUNT - 1) / 2) * COLUMN_WIDTH, 0.18, (row - 1) * ROW_DEPTH);
}

function createGalleryStage(ctx: GalleryCtx): void {
  const floor = ctx.add(
    new Mesh(
      new PlaneGeometry(22, 18),
      new MeshBasicMaterial({ color: 0x050a16, depthWrite: true }),
    ),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;

  const grid = ctx.add(new GridHelper(22, 22, 0x111a28, 0x091222));
  grid.position.y = 0.005;

  for (let slot = 0; slot < PAGE_SIZE; slot += 1) {
    const plate = ctx.add(
      new Mesh(
        new BoxGeometry(2.6, 0.11, 2.1),
        new MeshBasicMaterial({ color: 0x071020, transparent: true, opacity: 0.88 }),
      ),
    );
    plate.position.copy(tilePosition(slot));
    plate.position.y = 0.055;
  }
}

export class Gallery extends Scene<GalleryState> {
  static override readonly initialState = initialState;

  override enter(ctx: GalleryCtx): SceneFrame<GalleryState> {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 8.35, 11.8);
    camera.lookAt(0, 0.65, 0);
    ctx.viewport.resize();
    ctx.add(camera);
    ctx.scene.background = new Color(0x050a16);
    createGalleryStage(ctx);

    const effectEntities = new Map<string, GalleryEffectEntity>();

    const register = (
      ctx: GalleryCtx,
      id: string,
      options: readonly ConstructorParameters<typeof GPUParticles3D>[0][],
      index: number,
    ): void => {
      const position = tilePosition(index);
      const particles = options.map((option, layerIndex) => {
        const particle = ctx.add(new GPUParticles3D(option));
        particle.name = `vfx-${id}-${layerIndex}`;
        particle.position.copy(position);
        return particle;
      });
      const entity = new GalleryEffectEntity(
        particles,
        id,
        Math.floor(index / PAGE_SIZE),
        particles.reduce((total, particle) => total + particle.amount, 0),
        particles.length,
      );
      entity.setVisible(Math.floor(index / PAGE_SIZE));
      effectEntities.set(id, entity);
      ctx.entities.add(id, entity);
    };

    register(ctx, "fire", createFire(11), 0);
    register(ctx, "jet-flame", createJetFlame(13), 1);
    register(ctx, "burst-flash", createBurstFlash(71), 2);
    register(ctx, "muzzle-flash", createMuzzleFlash(73), 3);
    register(ctx, "smoke", createSmoke(17), 4);
    register(ctx, "dust-cloud", createDustCloud(19), 5);
    register(ctx, "steam-plume", createSteamPlume(23), 6);
    register(ctx, "ash-plume", createAshPlume(29), 7);
    register(ctx, "explosion-cloud", createExplosionCloud(31), 8);
    register(ctx, "impact-dust", createImpactDust(37), 9);
    register(ctx, "ground-mist", createGroundMist(41), 10);
    register(ctx, "poison-cloud", createPoisonCloud(43), 11);
    register(ctx, "rain", createRain(47), 12);
    register(ctx, "snow", createSnow(53), 13);
    register(ctx, "spark-streaks", createSparkStreaks(79), 14);
    register(ctx, "impact-sparks", createImpactSparks(83), 15);
    register(ctx, "ember-fountain", createEmberFountain(89), 16);
    register(ctx, "magic-wisp", createMagicWisp(103), 17);
    register(ctx, "magic-orb", createMagicOrb(107), 18);
    register(ctx, "magic-beam", createMagicBeam(109), 19);
    register(ctx, "healing-aura", createHealingAura(113), 20);
    register(ctx, "effekseer-fire01", createEffekseerFire01(127), 21);
    register(ctx, "effekseer-fire02", createEffekseerFire02(131), 22);
    register(ctx, "effekseer-fire03", createEffekseerFire03(137), 23);
    register(ctx, "effekseer-lightning01", createEffekseerLightning01(139), 24);
    register(ctx, "effekseer-lightning02", createEffekseerLightning02(149), 25);
    register(ctx, "effekseer-lightning03", createEffekseerLightning03(151), 26);
    register(ctx, "effekseer-ice01", createEffekseerIce01(157), 27);
    register(ctx, "effekseer-ice02", createEffekseerIce02(163), 28);
    register(ctx, "effekseer-ice03", createEffekseerIce03(167), 29);
    register(ctx, "effekseer-holy01", createEffekseerHoly01(173), 30);
    register(ctx, "effekseer-hit01", createEffekseerHit01(97), 31);
    register(ctx, "effekseer-hit02", createEffekseerHit02(101), 32);
    register(ctx, "effekseer-wind01", createEffekseerWind01(59), 33);
    register(ctx, "effekseer-wind02", createEffekseerWind02(61), 34);
    register(ctx, "effekseer-wind03", createEffekseerWind03(67), 35);
    register(ctx, "kenney-slash-arc", createKenneySlashArc(179), 36);
    register(ctx, "kenney-confetti-burst", createKenneyConfettiBurst(181), 37);
    register(ctx, "kenney-leaf-swirl", createKenneyLeafSwirl(191), 38);
    register(ctx, "pixi-bubble-stream", createPixiBubbleStream(193), 39);
    register(ctx, "pixi-cartoon-smoke-blast", createPixiCartoonSmokeBlast(197), 40);
    register(ctx, "godot-fireflies", createGodotFireflies(199), 41);

    const portal: IPortalVortex = createPortalVortex(229);
    const portalRing = ctx.add(new GPUParticles3D(portal.ring));
    portalRing.name = "vfx-godot-portal-vortex-ring";
    portalRing.position.copy(tilePosition(42));
    const portalRibbons = ctx.add(portal.ribbons);
    portalRibbons.name = "vfx-godot-portal-vortex-ribbons";
    portalRibbons.position.copy(tilePosition(42));
    const portalEntity = new GalleryEffectEntity(
      [portalRing, portalRibbons],
      "godot-portal-vortex",
      Math.floor(42 / PAGE_SIZE),
      portal.gpuCapacity,
      portal.spawnCommands,
    );
    portalEntity.setVisible(Math.floor(42 / PAGE_SIZE));
    effectEntities.set("godot-portal-vortex", portalEntity);
    ctx.entities.add("godot-portal-vortex", portalEntity);

    if (typeof window !== "undefined") {
      window.addEventListener("threenative-gallery-retrigger", () => {
        const page = ctx.state.getState().page;
        for (const entity of effectEntities.values()) {
          if (entity.page !== page) continue;
          for (const object of entity.objects) {
            if (object instanceof GPUParticles3D) object.restart();
          }
        }
      });
    }

    register(ctx, "godot-blood-splash", createGodotBloodSplash(211), 43);
    register(ctx, "godot-shield-break", createGodotShieldBreak(223), 44);
    register(ctx, "godot-waterfall-mist", createGodotWaterfallMist(227), 45);

    return (frameCtx) => {
      if (frameCtx.input.justPressed("nextPage")) {
        const page = (frameCtx.state.getState().page + 1) % PAGE_COUNT;
        for (const entity of effectEntities.values()) entity.setVisible(page);
        const portalDispatches = portalRibbons.dispatches;
        frameCtx.state.set({
          appliedIds: [...EFFECT_IDS],
          evaluatedTiles: EFFECT_IDS.length,
          missingTiles: [],
          page,
          pagesVisited: frameCtx.state.getState().pagesVisited + 1,
          burstCommands: EFFECT_IDS.length,
          gpuCapacity:
            EFFECT_IDS.reduce(
              (total, id) => total + (ctx.entities.get<GalleryEffectEntity>(id)?.gpuCapacity ?? 0),
              0,
            ) + portal.gpuCapacity,
          portalRingDispatches: portalDispatches > 0 ? 1 : 0,
          portalRibbonDispatches: portalDispatches,
        });
        events.push({ entity: "gallery", name: "coverage", count: EFFECT_IDS.length });
        events.push({ entity: "gallery", name: "page", page });
        if (portalDispatches > 0) {
          events.push({
            entity: "godot-portal-vortex",
            name: "compute-updated",
            dispatches: portalDispatches,
          });
        }
      }
    };
  }
}
