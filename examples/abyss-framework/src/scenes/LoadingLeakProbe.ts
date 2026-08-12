import { type ICtx, Scene, type SceneFrame } from "@threenative/core";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  PlaneGeometry,
} from "three";
import { LOADING_BACKDROP, createLoadingBackdrop } from "../render/loadingBackdrop.js";

const WORLD_MESHES = 200;

/** A deterministic, in-tree version of the moving waterfall that leaks on the field subject. */
export class LoadingLeakProbe extends Scene {
  override enter(ctx: ICtx): SceneFrame {
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    ctx.viewport.resize();
    ctx.scene.background = null;

    const world = new Group();
    const stoneGeometry = new BoxGeometry(0.18, 0.18, 0.18);
    const stoneMaterial = new MeshBasicMaterial({ color: 0x263541 });
    for (let index = 0; index < WORLD_MESHES; index += 1) {
      const stone = new Mesh(stoneGeometry, stoneMaterial);
      stone.position.set((index % 20) * 0.22 - 2.1, Math.floor(index / 20) * 0.22 - 1.1, -2);
      world.add(stone);
    }

    const waterfall = new Group();
    const waterMaterial = new MeshBasicMaterial({
      color: 0x4fb6e8,
      depthWrite: false,
      opacity: 0.9,
      side: DoubleSide,
      transparent: true,
    });
    for (let index = 0; index < 2; index += 1) {
      const sheet = new Mesh(new PlaneGeometry(2.4 - index * 0.35, 4.8), waterMaterial);
      sheet.position.z = index * 0.05;
      waterfall.add(sheet);
    }
    const streakGeometry = new PlaneGeometry(0.18, 0.9);
    const streakMaterial = new MeshBasicMaterial({
      color: 0xd7f6ff,
      depthWrite: false,
      opacity: 0.85,
      side: DoubleSide,
      transparent: true,
    });
    const streaks: Mesh[] = [];
    for (let index = 0; index < 16; index += 1) {
      const streak = new Mesh(streakGeometry, streakMaterial);
      streak.position.set(((index * 7) % 15) * 0.14 - 1, (index % 8) * 0.62 - 2.1, 0.1);
      // Procedural scenery owns these local matrices; Three.js need not rebuild them again.
      streak.matrixAutoUpdate = false;
      streak.updateMatrix();
      waterfall.add(streak);
      streaks.push(streak);
    }
    world.add(waterfall);
    ctx.add(world);

    // The field game has a camera HUD above the world. These ordinary meshes make the collapse
    // take the same camera-subtree path before the loading backdrop is added over them.
    const hudMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true });
    for (let index = 0; index < 12; index += 1) {
      const marker = new Mesh(new PlaneGeometry(0.02, 0.02), hudMaterial);
      marker.position.set(-0.2 + index * 0.035, 0.15, -1);
      camera.add(marker);
    }
    ctx.add(camera);

    const loading = createLoadingBackdrop(ctx);
    ctx.entities.add("loading-leak.waterfall", { mesh: waterfall });
    ctx.entities.add("loading-leak.backdrop", {
      debug: () => ({ color: LOADING_BACKDROP, covered: ctx.startup.phase !== "ready" }),
    });

    return (_frameCtx, dt) => {
      loading.update();
      for (const [index, streak] of streaks.entries()) {
        streak.position.y -= dt * (1.8 + index * 0.04);
        if (streak.position.y < -2.6) streak.position.y = 2.6;
        streak.updateMatrix();
      }
    };
  }
}
