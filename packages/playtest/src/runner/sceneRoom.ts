import type {
  IPlaytestAnimationObservation,
  IPlaytestObservationSnapshot,
  IPlaytestSceneObservation,
} from "../protocol.js";

/**
 * The room and the feet — the two things `doctor --url` used to list under "not observed".
 *
 * An agent looking at a black or washed-out frame had no instrument between "the bridge answered"
 * and "here is a screenshot", so it guessed. These two summaries close that gap with numbers the
 * page already knows: what is lit, how far the fog and the camera reach, and whether a walking
 * character's feet agree with the ground it covers.
 */

/** Above this fraction the feet and the ground disagree enough for a player to see it. */
export const FOOT_SLIDE_WARNING_RATIO = 0.25;

/** Below this the body is standing still and a slide ratio would be dividing by noise. */
const GROUND_SPEED_FLOOR = 1e-3;

/**
 * Materials whose colour comes from the lights in the scene. With none lit, everything wearing one
 * of these renders black while every other number in the report stays healthy.
 */
const LIT_MATERIAL_PATTERN = /standard|physical|lambert|phong|toon/iu;

export interface ISceneRoomSummary {
  readonly background: string;
  readonly camera: IPlaytestSceneObservation["camera"];
  readonly fog?: IPlaytestSceneObservation["fog"];
  readonly lights: { count: number; types: Record<string, number>; visible: number };
  readonly litMaterials: number;
  readonly materials: Record<string, number>;
  readonly objects: number;
  readonly truncated: boolean;
  readonly worldExtent?: IPlaytestSceneObservation["worldExtent"];
}

export interface IFootSlideReading {
  readonly clip: string;
  readonly entity: string;
  /** Metres per second the clip's feet carry at the applied rate. */
  readonly feetSpeed: number;
  readonly groundSpeed: number;
  readonly overridden: boolean;
  /** |feet − ground| / ground. Zero is agreement. */
  readonly ratio: number;
  readonly synced: boolean;
}

export function summariseRoom(scene: IPlaytestSceneObservation): ISceneRoomSummary {
  const types: Record<string, number> = {};
  for (const light of scene.lights) types[light.type] = (types[light.type] ?? 0) + 1;
  const litMaterials = Object.entries(scene.materials)
    .filter(([name]) => LIT_MATERIAL_PATTERN.test(name))
    .reduce((total, [, count]) => total + count, 0);
  return {
    background: scene.background,
    camera: scene.camera,
    ...(scene.fog === undefined ? {} : { fog: scene.fog }),
    lights: {
      count: scene.lights.length,
      types,
      visible: scene.lights.filter(({ visible }) => visible).length,
    },
    litMaterials,
    materials: scene.materials,
    objects: scene.objects,
    truncated: scene.truncated,
    ...(scene.worldExtent === undefined ? {} : { worldExtent: scene.worldExtent }),
  };
}

/**
 * How far the camera is from the furthest corner of everything in the scene.
 *
 * Corner distance rather than centre distance: a fog or clip plane cuts the far side of the world
 * first, and that far side is what a player sees as a wall of fog or a hole in the horizon.
 */
export function furthestSceneCornerDistance(summary: ISceneRoomSummary): number | undefined {
  const extent = summary.worldExtent;
  if (extent === undefined) return undefined;
  const [cx, cy, cz] = summary.camera.position;
  let furthest = 0;
  for (const x of [extent.min[0], extent.max[0]])
    for (const y of [extent.min[1], extent.max[1]])
      for (const z of [extent.min[2], extent.max[2]])
        furthest = Math.max(furthest, Math.hypot(x - cx, y - cy, z - cz));
  return furthest;
}

/**
 * Read the feet against the ground for every clip the game reports a stride for.
 *
 * An entity with no stride report is absent from the result rather than present at zero: the
 * measurement is the producer's, and a game that does not measure it has not measured zero slide.
 */
export function readFootSlide(
  animations: Record<string, IPlaytestAnimationObservation> | undefined,
): IFootSlideReading[] {
  const readings: IFootSlideReading[] = [];
  for (const [entity, animation] of Object.entries(animations ?? {})) {
    const { stride } = animation;
    if (stride === undefined) continue;
    if (Math.abs(stride.groundSpeed) <= GROUND_SPEED_FLOOR) continue;
    // The rate the action is running at, not the rate the player merely measured: an overridden
    // clip keeps its authored rate, and reading the measured one back reports zero slide for the
    // exact case the warning exists to catch.
    const feetSpeed = stride.clipGroundSpeed * (stride.synced ? stride.rate : 1);
    readings.push({
      clip: animation.clip,
      entity,
      feetSpeed,
      groundSpeed: stride.groundSpeed,
      overridden: stride.overridden,
      ratio: Math.abs(feetSpeed - stride.groundSpeed) / Math.abs(stride.groundSpeed),
      synced: stride.synced,
    });
  }
  return readings;
}

export function roomWarnings(
  summary: ISceneRoomSummary,
  slides: readonly IFootSlideReading[],
): string[] {
  const warnings: string[] = [];
  if (summary.litMaterials > 0 && summary.lights.visible === 0) {
    warnings.push(
      `${summary.litMaterials} lit materials and no visible light in the scene — everything wearing one renders black while every other number here stays healthy`,
    );
  }
  const furthest = furthestSceneCornerDistance(summary);
  const fog = summary.fog;
  if (furthest !== undefined && fog?.type === "linear" && fog.far !== undefined && fog.far < furthest) {
    warnings.push(
      `fog reaches full ${fog.color} at ${fog.far.toFixed(1)} units but the scene runs to ${furthest.toFixed(1)} — everything past the far plane is one flat wash, whatever it was authored to look like`,
    );
  }
  if (furthest !== undefined && summary.camera.far !== undefined && summary.camera.far < furthest) {
    warnings.push(
      `the camera's far plane is ${summary.camera.far.toFixed(1)} and the scene runs to ${furthest.toFixed(1)} — geometry past it is clipped, not drawn small`,
    );
  }
  if (summary.truncated) {
    warnings.push(
      "the scene walk hit its cap, so the object, light and material counts above are floors rather than totals",
    );
  }
  for (const slide of slides) {
    if (slide.ratio <= FOOT_SLIDE_WARNING_RATIO) continue;
    warnings.push(
      `${slide.entity}'s feet and the ground disagree by ${(slide.ratio * 100).toFixed(0)}% on clip '${slide.clip}' — the clip carries ${slide.feetSpeed.toFixed(2)} m/s and the body covers ${slide.groundSpeed.toFixed(2)} m/s${slide.synced ? "" : slide.overridden ? " (strideSync is off, so this is the cost of that override)" : ""}`,
    );
  }
  return warnings;
}

export function readSceneRoom(
  snapshot: IPlaytestObservationSnapshot,
): { slides: IFootSlideReading[]; summary: ISceneRoomSummary } | undefined {
  if (snapshot.scene === undefined) return undefined;
  return {
    slides: readFootSlide(snapshot.gameplay?.animation),
    summary: summariseRoom(snapshot.scene),
  };
}

export function formatRoomLines(room: {
  slides: readonly IFootSlideReading[];
  summary: ISceneRoomSummary;
}): string[] {
  const { summary } = room;
  const lightTypes = Object.entries(summary.lights.types)
    .map(([type, count]) => `${count}× ${type}`)
    .join(", ");
  const materials = Object.entries(summary.materials)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4)
    .map(([type, count]) => `${count}× ${type}`)
    .join(", ");
  const camera = summary.camera;
  const clip =
    camera.near === undefined || camera.far === undefined
      ? "clip planes not observed"
      : `clip ${camera.near}..${camera.far}`;
  const lines = [
    `  lighting     ${
      summary.lights.count === 0 ? "no lights in the scene" : `${summary.lights.visible}/${summary.lights.count} visible — ${lightTypes}`
    } · background ${summary.background}${
      summary.fog === undefined
        ? " · no fog"
        : summary.fog.type === "linear"
          ? ` · fog ${summary.fog.color} ${summary.fog.near}..${summary.fog.far}`
          : ` · fog ${summary.fog.color} density ${summary.fog.density}`
    }`,
    `  materials    ${
      materials.length === 0 ? "no materials observed" : materials
    } (${summary.litMaterials} lit) across ${summary.objects.toLocaleString("en-US")} objects`,
    `  camera       ${camera.type} at ${camera.position.map((value) => Number(value.toFixed(2))).join(", ")} · ${
      camera.fov === undefined ? "orthographic" : `fov ${camera.fov}°`
    } · ${clip}`,
  ];
  for (const slide of room.slides) {
    lines.push(
      `  stride       ${slide.entity} '${slide.clip}' feet ${slide.feetSpeed.toFixed(2)} m/s vs ground ${slide.groundSpeed.toFixed(2)} m/s (${(slide.ratio * 100).toFixed(0)}% apart, ${slide.synced ? "synced" : slide.overridden ? "override" : "not synced"})`,
    );
  }
  return lines;
}
