import { AudioBus, type Ctx, Scene, type SceneFrame } from "@threenative/core";
import { Area3D, CollisionShape3D, type PhysicsContext, RigidBody3D } from "@threenative/physics";
import {
  Group,
  Mesh,
  type Material,
  type PerspectiveCamera,
  PointLight,
  Vector3,
} from "three";
import { Player, HUB_SPAWN } from "../entities/Player.js";
import { createSpringArm } from "../render/camera.js";
import { setupLighting } from "../render/lighting.js";
import { createMaterials } from "../render/materials.js";
import { createParticles } from "../render/particles.js";
import { setupPost } from "../render/postprocessing.js";
import { ball, block, spike, tube } from "../render/shapes.js";
import { setupSky } from "../render/sky.js";
import type { AreaId, GameState, PointId } from "../state.js";

export type GameCtx = Ctx<GameState, PhysicsContext>;

const KILL_PLANE = -4;
const NORTH_GATE_Z = 0.6;
const SOUTH_GATE_Z = 6;
const TRANSITION_ARRIVAL_SECONDS = 0.18;
const TRANSITION_DURATION_SECONDS = 0.52;

const AREA_COPY: Record<AreaId, { label: string; transition: string; subtitle: string }> = {
  hub: {
    label: "STARWELL HUB",
    transition: "Returning to the Starwell",
    subtitle: "The central light is still listening.",
  },
  north: {
    label: "NORTHERN ARCHIVE",
    transition: "Entering the Northern Archive",
    subtitle: "A warmer arrangement waits beyond the brass gate.",
  },
  south: {
    label: "SOUTHERN LANTERN GROVE",
    transition: "Entering the Southern Lantern Grove",
    subtitle: "Teal fireflies mark the path through the old trees.",
  },
};

type MaterialSet = ReturnType<typeof createMaterials>;

type PointVisual = {
  readonly root: Group;
  readonly orb: Mesh;
};

type InspectPoint = {
  readonly id: PointId;
  readonly area: AreaId;
  readonly title: string;
  readonly eyebrow: string;
  readonly detail: string;
  readonly position: Vector3;
  readonly visual: PointVisual;
};

function addBlock(
  parent: Group,
  width: number,
  height: number,
  depth: number,
  material: Material,
  x: number,
  y: number,
  z: number,
  radius = 0.14,
): Mesh {
  const mesh = block(width, height, depth, material, { radius });
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function addStaticFloor(
  ctx: GameCtx,
  width: number,
  depth: number,
  x: number,
  z: number,
  materials: MaterialSet,
): void {
  const floor = block(width, 0.38, depth, materials.floor, { radius: 0.24 });
  floor.position.set(x, -0.19, z);
  ctx.add(floor);
  floor.receiveShadow = true;
  new RigidBody3D({
    object: floor,
    physics: ctx.physics,
    shape: CollisionShape3D.fromMesh(floor),
    type: "fixed",
  });

  const inset = block(width - 0.42, 0.04, depth - 0.42, materials.floorEdge, { radius: 0.18 });
  inset.position.set(x, 0.015, z);
  inset.receiveShadow = true;
  ctx.add(inset);
}

function createTree(parent: Group, x: number, z: number, scale: number, materials: MaterialSet): void {
  const tree = new Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);

  const trunk = tube(0.18, 0.25, 1.45, materials.crate, { segments: 10 });
  trunk.position.y = 0.72;
  tree.add(trunk);

  const lowerCanopy = ball(0.92, materials.foliage, { segments: 14 });
  lowerCanopy.position.set(0, 1.58, 0.02);
  tree.add(lowerCanopy);

  const upperCanopy = ball(0.67, materials.foliageLight, { segments: 14 });
  upperCanopy.position.set(-0.28, 2.16, -0.06);
  tree.add(upperCanopy);

  parent.add(tree);
}

function createGate(parent: Group, z: number, materials: MaterialSet, side: "north" | "south"): void {
  const gate = new Group();
  const gateMaterial = side === "north" ? materials.goldGlow : materials.glow;
  addBlock(gate, 0.38, 1.8, 0.38, materials.stoneLight, -1.1, 0.9, z, 0.08);
  addBlock(gate, 0.38, 1.8, 0.38, materials.stoneLight, 1.1, 0.9, z, 0.08);
  addBlock(gate, 2.62, 0.26, 0.42, gateMaterial, 0, 1.72, z, 0.07);
  const signal = ball(0.2, gateMaterial, { segments: 12, castShadow: false, receiveShadow: false });
  signal.position.set(0, 2.08, z);
  gate.add(signal);
  const marker = block(1.82, 0.12, 0.12, gateMaterial, { radius: 0.04 });
  marker.position.set(0, 0.08, z + (side === "north" ? 0.2 : -0.2));
  gate.add(marker);
  parent.add(gate);
}

function createShrine(parent: Group, materials: MaterialSet): void {
  const shrine = new Group();
  const base = tube(1.15, 1.38, 0.26, materials.stoneLight, { segments: 16 });
  base.position.y = 0.13;
  shrine.add(base);

  const plinth = addBlock(shrine, 1.42, 0.32, 1.42, materials.stone, 0, 0.38, 0, 0.16);
  plinth.receiveShadow = true;
  addBlock(shrine, 1.02, 2.18, 1.02, materials.crate, 0, 1.58, 0, 0.12);
  addBlock(shrine, 1.2, 0.18, 1.2, materials.accent, 0, 2.72, 0, 0.05);

  const roof = spike(0.92, 0.84, materials.accent, { segments: 4 });
  roof.position.y = 3.23;
  roof.rotation.y = Math.PI / 4;
  shrine.add(roof);

  const window = ball(0.3, materials.goldGlow, { segments: 16, castShadow: false, receiveShadow: false });
  window.position.set(0, 1.68, -0.54);
  shrine.add(window);

  const finial = tube(0.07, 0.07, 0.56, materials.goldGlow, { segments: 10 });
  finial.position.y = 3.85;
  shrine.add(finial);
  const finialOrb = ball(0.13, materials.glow, { segments: 12, castShadow: false, receiveShadow: false });
  finialOrb.position.y = 4.16;
  shrine.add(finialOrb);

  const light = new PointLight(0xf2bd69, 4.4, 9, 2);
  light.position.set(0, 2.7, -0.2);
  shrine.add(light);
  shrine.position.set(0, 0, -0.92);
  parent.add(shrine);
}

function createFocusMarker(position: Vector3, material: Material, glowMaterial: Material): PointVisual {
  const root = new Group();
  root.position.copy(position);

  const base = tube(0.42, 0.52, 0.1, material, { segments: 12 });
  base.position.y = 0.05;
  root.add(base);

  const pedestal = block(0.28, 0.22, 0.28, material, { radius: 0.06 });
  pedestal.position.y = 0.2;
  root.add(pedestal);

  const orb = ball(0.18, glowMaterial, { segments: 14, castShadow: false, receiveShadow: false });
  orb.position.y = 0.54;
  root.add(orb);

  const tip = spike(0.15, 0.28, glowMaterial, { segments: 6, castShadow: false, receiveShadow: false });
  tip.position.y = 0.83;
  root.add(tip);

  return { root, orb };
}

function createHubProps(ctx: GameCtx, materials: MaterialSet): Group {
  const hub = new Group();
  ctx.add(hub);
  createShrine(hub, materials);
  createTree(hub, -4.75, -1.2, 1.35, materials);
  createTree(hub, 4.9, -1.0, 1.18, materials);
  createTree(hub, -3.9, 4.3, 0.72, materials);
  createTree(hub, 3.9, 4.15, 0.78, materials);

  for (const z of [3.5, 2.2, 0.9, -0.4]) {
    addBlock(hub, 2.2, 0.07, 0.55, materials.stoneLight, 0, 0.07, z, 0.04);
  }

  const leftMarker = tube(0.28, 0.38, 0.12, materials.stoneLight, { segments: 12 });
  leftMarker.position.set(-2.7, 0.12, 2.8);
  hub.add(leftMarker);
  const rightMarker = tube(0.28, 0.38, 0.12, materials.stoneLight, { segments: 12 });
  rightMarker.position.set(2.7, 0.12, 2.8);
  hub.add(rightMarker);

  return hub;
}

function createArchiveProps(ctx: GameCtx, materials: MaterialSet): Group {
  const archive = new Group();
  ctx.add(archive);

  addBlock(archive, 0.86, 3.7, 0.86, materials.stoneLight, 9.65, 1.85, -1.72, 0.1);
  addBlock(archive, 0.86, 3.7, 0.86, materials.stoneLight, 15.75, 1.85, -1.72, 0.1);
  addBlock(archive, 6.9, 0.42, 0.58, materials.stone, 12.7, 0.21, -2.0, 0.12);
  addBlock(archive, 6.2, 0.16, 0.18, materials.goldGlow, 12.7, 1.25, -1.7, 0.04);

  const shelves = [
    { x: 10.7, z: 0.2, h: 1.55 },
    { x: 12.05, z: -0.6, h: 0.95 },
    { x: 15.05, z: 0.6, h: 1.15 },
  ];
  shelves.forEach(({ x, z, h }, index) => {
    addBlock(archive, 0.68, h, 1.1, index % 2 === 0 ? materials.crate : materials.accent, x, h / 2, z, 0.09);
    addBlock(archive, 0.86, 0.12, 1.25, materials.stoneLight, x, h + 0.07, z, 0.04);
  });

  const lensStand = new Group();
  const stand = tube(0.54, 0.72, 0.18, materials.stoneLight, { segments: 14 });
  stand.position.y = 0.09;
  lensStand.add(stand);
  const lensStem = tube(0.08, 0.1, 0.9, materials.goldGlow, { segments: 10 });
  lensStem.position.y = 0.56;
  lensStand.add(lensStem);
  const lens = ball(0.34, materials.glow, { segments: 16, castShadow: false, receiveShadow: false });
  lens.position.y = 1.14;
  lensStand.add(lens);
  lensStand.position.set(13.75, 0, -0.35);
  archive.add(lensStand);

  const light = new PointLight(0x5de4d1, 3.6, 8, 2);
  light.position.set(13.75, 2.4, -0.35);
  archive.add(light);

  addBlock(archive, 0.48, 0.48, 0.48, materials.crate, 10.6, 0.24, 2.4, 0.08);
  addBlock(archive, 0.56, 0.56, 0.56, materials.accent, 11.25, 0.28, 2.35, 0.08);
  addBlock(archive, 0.44, 0.44, 0.44, materials.crate, 16.1, 0.22, 2.35, 0.08);
  return archive;
}

function createGroveProps(ctx: GameCtx, materials: MaterialSet): Group {
  const grove = new Group();
  ctx.add(grove);

  createTree(grove, -15.2, -1.45, 1.65, materials);
  createTree(grove, -10.05, -1.0, 1.05, materials);
  createTree(grove, -14.6, 3.2, 0.82, materials);

  const ring = tube(1.3, 1.48, 0.22, materials.stoneLight, { segments: 14 });
  ring.position.set(-13.15, 0.11, -0.62);
  grove.add(ring);
  addBlock(grove, 1.45, 0.3, 1.45, materials.stone, -13.15, 0.35, -0.62, 0.18);
  addBlock(grove, 0.38, 1.25, 0.38, materials.crate, -13.15, 0.98, -0.62, 0.08);

  const crystalPositions = [
    { x: -15.35, z: 1.35, h: 0.9 },
    { x: -13.9, z: 2.1, h: 0.58 },
    { x: -11.3, z: 1.5, h: 0.72 },
  ];
  crystalPositions.forEach(({ x, z, h }, index) => {
    const crystal = spike(0.32 + index * 0.04, h, index === 1 ? materials.goldGlow : materials.glow, {
      segments: 6,
      castShadow: false,
      receiveShadow: false,
    });
    crystal.position.set(x, h / 2, z);
    grove.add(crystal);
  });

  addBlock(grove, 3.8, 0.12, 0.42, materials.stoneLight, -13.0, 0.07, -3.0, 0.04);
  addBlock(grove, 2.1, 0.2, 1.15, materials.stone, -10.2, 0.1, 2.4, 0.1);
  addBlock(grove, 1.05, 0.72, 0.78, materials.crate, -16.0, 0.36, 2.55, 0.1);

  const light = new PointLight(0x5de4d1, 3.2, 8, 2);
  light.position.set(-13.4, 2, 0.2);
  grove.add(light);
  return grove;
}

export class Play extends Scene<GameState, PhysicsContext> {
  static override readonly initialState: GameState = {
    area: "hub",
    coyoteJumps: 0,
    inspections: 0,
    inspectedPoints: [],
    jumps: 0,
    levelX: 0,
    objectiveComplete: false,
    peakRise: 0,
    playerX: HUB_SPAWN.x,
    playerZ: HUB_SPAWN.z,
    respawns: 0,
    returns: 0,
    score: 0,
    nearbyPoint: null,
    transitionActive: false,
    transitionTitle: "",
    transitionSubtitle: "",
    lastInspected: null,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, PhysicsContext> {
    const audio = ctx.entities.add("audio", new AudioBus({ camera: ctx.camera }));
    const pickupAudio = ctx.assets.audio("pickup.ogg");
    void pickupAudio.catch(() => undefined);

    setupSky(ctx.scene);
    setupLighting(ctx.scene, ctx.renderer.raw as Parameters<typeof setupLighting>[1]);
    setupPost(ctx.renderer, ctx.scene, ctx.camera);
    if (ctx.renderer.kind === "webgpu") ctx.add(createParticles());

    const camera = ctx.camera as PerspectiveCamera;
    const springArm = createSpringArm(camera, {
      offset: new Vector3(0, 4.7, 8.05),
      lookAhead: new Vector3(0, 1.05, -0.65),
      damping: 0.2,
    });
    camera.fov = 54;
    camera.updateProjectionMatrix();

    const materials = createMaterials();
    addStaticFloor(ctx, 13, 11, 0, 1.5, materials);
    addStaticFloor(ctx, 11, 10, 0, -2.5, materials);
    addStaticFloor(ctx, 11, 10, 0, 10.5, materials);

    const shared = new Group();
    ctx.add(shared);
    createGate(shared, NORTH_GATE_Z, materials, "north");
    createGate(shared, SOUTH_GATE_Z, materials, "south");

    const hubProps = createHubProps(ctx, materials);
    const archiveProps = createArchiveProps(ctx, materials);
    const groveProps = createGroveProps(ctx, materials);
    archiveProps.rotation.y = Math.PI / 2;
    archiveProps.position.z = 10.5;
    groveProps.rotation.y = Math.PI / 2;

    const points: InspectPoint[] = [
      {
        id: "hub.beacon",
        area: "hub",
        title: "Starwell Beacon",
        eyebrow: "01 / CENTRAL SIGNAL",
        detail: "The old beacon still answers with a low amber pulse. The two gates are listening for the same note.",
        position: new Vector3(0, 0, 0.35),
        visual: createFocusMarker(new Vector3(0, 0, 0.35), materials.stoneLight, materials.goldGlow),
      },
      {
        id: "north.archive",
        area: "north",
        title: "Archive Lens",
        eyebrow: "02 / NORTHERN MEMORY",
        detail: "A teal lens refracts the shape of the hub. Someone built this room to remember the way home.",
        position: new Vector3(0.35, 0, -3.25),
        visual: createFocusMarker(new Vector3(0.35, 0, -3.25), materials.stoneLight, materials.glow),
      },
      {
        id: "south.grove",
        area: "south",
        title: "Grove Memory",
        eyebrow: "03 / SOUTHERN ECHO",
        detail: "The grove holds a warm shard beneath the branches. Its rhythm matches the Starwell exactly.",
        position: new Vector3(0.62, 0, 13.15),
        visual: createFocusMarker(new Vector3(0.62, 0, 13.15), materials.stoneLight, materials.goldGlow),
      },
    ];
    points.forEach((point) => {
      const parent = point.area === "hub" ? hubProps : point.area === "north" ? archiveProps : groveProps;
      parent.add(point.visual.root);
    });

    // This small route pulse keeps the starter's sealed playtest meaningful while
    // the three journal entries remain deliberate E-to-inspect discoveries.
    const routePulse = ball(0.16, materials.glow, { segments: 12, castShadow: false, receiveShadow: false });
    routePulse.position.set(3.3, 0.38, 5.15);
    shared.add(routePulse);
    let routePulseFound = false;

    const player = new Player(ctx, materials.player, materials.glow);
    ctx.entities.add("player", player);
    springArm.snap(player.mesh.position);

    const pulseArea = new Area3D({
      physics: ctx.physics,
      position: { x: 3.3, y: 0.5, z: 5.15 },
      shape: CollisionShape3D.box(0.9, 1.2, 0.9),
    });
    pulseArea.on("bodyEntered", (body) => {
      if (body !== player.body || routePulseFound) return;
      routePulseFound = true;
      const current = ctx.state.getState();
      ctx.state.set({ score: current.score + 1 });
      void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
    });

    const props = { hub: hubProps, north: archiveProps, south: groveProps } satisfies Record<AreaId, Group>;
    let area: AreaId = "hub";
    let transition: { target: AreaId; elapsed: number; arrived: boolean } | null = null;

    const setAreaVisibility = (nextArea: AreaId): void => {
      props.hub.visible = nextArea === "hub";
      props.north.visible = nextArea === "north";
      props.south.visible = nextArea === "south";
    };
    setAreaVisibility(area);

    const spawnFor = (nextArea: AreaId, fromArea: AreaId): { x: number; y: number; z: number } => {
      if (nextArea === "north") return { x: 0.35, y: 0.62, z: -1.2 };
      if (nextArea === "south") return { x: 0.62, y: 0.62, z: 6.8 };
      if (fromArea === "hub") return HUB_SPAWN;
      return HUB_SPAWN;
    };

    const beginTransition = (target: AreaId): void => {
      if (transition !== null || target === area) return;
      transition = { target, elapsed: 0, arrived: false };
      player.body.velocity.x = 0;
      player.body.velocity.y = 0;
      player.body.velocity.z = 0;
      ctx.state.set({
        nearbyPoint: null,
        transitionActive: true,
        transitionTitle: AREA_COPY[target].transition,
        transitionSubtitle: AREA_COPY[target].subtitle,
      });
    };

    const finishTransition = (target: AreaId): void => {
      const previousArea = area;
      area = target;
      setAreaVisibility(area);
      player.respawn(spawnFor(target, previousArea));
      springArm.snap(player.mesh.position);
      const current = ctx.state.getState();
      ctx.state.set({
        area,
        nearbyPoint: null,
        playerX: player.mesh.position.x,
        playerZ: player.mesh.position.z,
        returns: target === "hub" && previousArea !== "hub" ? current.returns + 1 : current.returns,
      });
    };

    const nearestPoint = (): InspectPoint | null => {
      let best: InspectPoint | null = null;
      let bestDistance = 2.5 * 2.5;
      for (const point of points) {
        if (point.area !== area) continue;
        const distance = point.position.distanceToSquared(player.mesh.position);
        if (distance < bestDistance) {
          best = point;
          bestDistance = distance;
        }
      }
      return best;
    };

    const inspect = (point: InspectPoint): void => {
      const current = ctx.state.getState();
      const alreadyInspected = current.inspectedPoints.includes(point.id);
      if (!alreadyInspected) {
        const inspectedPoints = [...current.inspectedPoints, point.id];
        const inspections = inspectedPoints.length;
        ctx.state.set({
          inspectedPoints,
          inspections,
          objectiveComplete: inspections >= 3,
          score: Math.max(current.score, inspections),
          lastInspected: point.id,
        });
        void pickupAudio.then((buffer) => audio.play(buffer)).catch(() => undefined);
      } else {
        ctx.state.set({ lastInspected: point.id });
      }
    };

    ctx.state.set({ area: "hub", nearbyPoint: null, transitionActive: false });

    return (frameCtx, dt) => {
      if (transition !== null) {
        transition.elapsed += dt;
        ctx.state.set({
          transitionTitle: AREA_COPY[transition.target].transition,
          transitionSubtitle: AREA_COPY[transition.target].subtitle,
        });
        if (!transition.arrived && transition.elapsed >= TRANSITION_ARRIVAL_SECONDS) {
          transition.arrived = true;
          finishTransition(transition.target);
        }
        if (transition.elapsed >= TRANSITION_DURATION_SECONDS) {
          transition = null;
          ctx.state.set({ transitionActive: false, transitionTitle: "", transitionSubtitle: "" });
        }
        return;
      }

      player.update(frameCtx, dt);
      let respawned = false;
      if (player.mesh.position.y < KILL_PLANE) {
        player.respawn(spawnFor(area, area));
        springArm.snap(player.mesh.position);
        respawned = true;
      }

      const current = frameCtx.state.getState();
      const point = nearestPoint();
      if (frameCtx.input.justPressed("inspect") && point !== null) inspect(point);

      if (area === "hub" && player.mesh.position.z < NORTH_GATE_Z) beginTransition("north");
      if (area === "hub" && player.mesh.position.z > SOUTH_GATE_Z) beginTransition("south");
      if (area === "north" && player.mesh.position.z > NORTH_GATE_Z) beginTransition("hub");
      if (area === "south" && player.mesh.position.z < SOUTH_GATE_Z) beginTransition("hub");

      springArm.follow(player.mesh.position, dt);
      const debug = player.debug();
      frameCtx.state.set({
        coyoteJumps: debug.coyoteJumps,
        jumps: debug.jumps,
        peakRise: Math.max(current.peakRise, player.mesh.position.y - HUB_SPAWN.y),
        playerX: player.mesh.position.x,
        playerZ: player.mesh.position.z,
        respawns: current.respawns + (respawned ? 1 : 0),
        nearbyPoint: point?.id ?? null,
      });

      for (const candidate of points) {
        candidate.visual.root.rotation.y += dt * 0.45;
        candidate.visual.orb.position.y = 0.54 + Math.sin(performance.now() * 0.003 + candidate.position.x) * 0.06;
      }
      routePulse.rotation.y += dt * 1.6;
      routePulse.position.y = 0.38 + Math.sin(performance.now() * 0.004) * 0.05;
    };
  }
}
