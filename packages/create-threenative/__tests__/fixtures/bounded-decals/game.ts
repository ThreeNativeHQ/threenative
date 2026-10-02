import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  type PerspectiveCamera,
  Vector3,
} from "three";
import type { WebGPURenderer } from "three/webgpu";
import { type ICtx, Scene, baseGeometryOf, defineGame } from "../../../../core/dist/index.js";
import { playtest } from "../../../../core/dist/playtest.js";
import { DecalField, bulletHoleTexture } from "../../../templates/shooter/src/render/decals.js";

/** Portable, opt-in runtime proof. Neither the shooter entry nor its authored look is changed. */
export function createDecalFixture(hideDecals = false) {
  let generation = 0;
  class DecalRoom extends Scene {
    #source: Object3D | undefined;
    #dispose = () => {};

    override async load(ctx: ICtx): Promise<void> {
      const model = await ctx.assets.model<{ scene: Object3D }>("receiver.glb");
      this.#source = model.scene;
    }

    override enter(ctx: ICtx) {
      generation += 1;
      const source = this.#source?.getObjectByProperty("isMesh", true);
      if (!(source instanceof Mesh)) throw new Error("Decal fixture receiver did not load.");
      const camera = ctx.camera as PerspectiveCamera;
      camera.position.set(0, 4.5, 12);
      camera.lookAt(0, 2.3, 0);
      ctx.scene.background = new Color(0x17232f);
      const materials = [0xc7b493, 0x84a9ad, 0x36485a].map(
        (color) => new MeshStandardMaterial({ color, roughness: 0.9 }),
      );
      const left = source.clone();
      const right = source.clone();
      left.material = materials[0] as MeshStandardMaterial;
      right.material = materials[1] as MeshStandardMaterial;
      left.position.set(-2.5, 2.4, 0);
      right.position.set(2.5, 2.4, 0);
      ctx.add(left);
      ctx.add(right);
      const floorGeometry = new BoxGeometry(15, 0.15, 10);
      const floor = new Mesh(floorGeometry, materials[2]);
      floor.position.y = -0.1;
      ctx.add(floor);
      const sun = new DirectionalLight(0xffefd2, 3);
      sun.position.set(2, 7, 8);
      ctx.add(sun);
      ctx.add(new AmbientLight(0xdbeaff, 1.5));
      const map = bulletHoleTexture(64);
      const field = new DecalField(ctx.scene, {
        countPerVariant: 256,
        map,
        offset: 0.008,
        size: 0.19,
        tints: { impact: 0xffffff },
      });
      field.settle();
      let created = 0;
      let released = 0;
      const stamp = (receiver: Mesh, x: number, y: number): void => {
        receiver.updateWorldMatrix(true, false);
        const origin = receiver.localToWorld(new Vector3(x, y, 2));
        const direction = new Vector3(0, 0, -1).transformDirection(receiver.matrixWorld);
        const hit = ctx.raycast({
          origin,
          direction,
          targets: receiver,
          exclude: receiver.children,
        });
        if (hit?.object !== receiver || hit.face === null || hit.face === undefined) {
          throw new Error("Decal fixture lost its authored picking surface.");
        }
        const normal = hit.face.normal.clone().transformDirection(receiver.matrixWorld);
        if (
          !field.project(receiver, baseGeometryOf(receiver), hit.point, normal, "impact", {
            depth: 0.1,
          })
        ) {
          throw new Error("Decal fixture projection unexpectedly missed.");
        }
        const slot = receiver.children.at(-1);
        if (!(slot instanceof Mesh)) throw new Error("Decal fixture has no projected slot.");
        // Negative control: preserve real picking, projection, allocations and observations,
        // but suppress the material's actual draw. The pixel gate must reject this scene.
        slot.material.visible = !hideDecals;
        created += 1;
        slot.geometry.addEventListener("dispose", () => {
          released += 1;
        });
      };
      for (let hit = 0; hit < 320; hit += 1) {
        const index = Math.floor(hit / 2);
        stamp(
          hit % 2 === 0 ? left : right,
          -1.6 + (index % 16) * 0.213,
          -1.45 + Math.floor(index / 16) * 0.32,
        );
      }
      let moving = false;
      let elapsed = 0;
      let frames = 0;
      let motionError = 0;
      let lodHit = false;
      let maxDrawCalls = 0;
      const base = baseGeometryOf(left);
      if (base.index?.count !== 384)
        throw new Error("Decal fixture LOD0 must contain 128 triangles.");
      const observation = () => {
        let geometryBytes = 0;
        let active = 0;
        for (const receiver of [left, right]) {
          for (const child of receiver.children) {
            if (!(child instanceof Mesh)) continue;
            active += 1;
            const geometry: BufferGeometry = child.geometry;
            for (const attribute of Object.values(geometry.attributes)) {
              geometryBytes += attribute.array.byteLength;
            }
            geometryBytes += geometry.index?.array.byteLength ?? 0;
          }
        }
        return {
          generation,
          active,
          capacity: field.capacity,
          created,
          released,
          geometryBytes,
          maxDrawCalls,
          motionError,
          receiverMotion: Math.abs(right.rotation.y) + Math.abs(right.position.y - 2.4),
          lodHit,
          renderTriangles: (left.geometry.index?.count ?? 0) / 3,
          receiverRemoved: right.parent === null,
        };
      };
      ctx.entities.add("decals", { debug: observation });
      this.#dispose = () => {
        field.dispose();
        map.dispose();
        floorGeometry.dispose();
        for (const material of materials) material.dispose();
      };
      return (frame: ICtx, dt: number) => {
        maxDrawCalls = Math.max(
          maxDrawCalls,
          (ctx.renderer.raw as WebGPURenderer).info.render.drawCalls,
        );
        if (frame.input.justPressed("motion")) moving = !moving;
        if (frame.input.justPressed("remove")) right.removeFromParent();
        if (frame.input.justPressed("reset")) {
          void frame.goto("room");
          return;
        }
        if (moving) {
          elapsed += dt;
          right.rotation.y = Math.sin(elapsed) * 0.5;
          right.position.y = 2.4 + Math.sin(elapsed * 1.5) * 0.35;
        }
        field.update();
        right.updateWorldMatrix(true, true);
        const mark = right.children[0];
        if (mark instanceof Mesh) {
          const local = new Vector3().fromBufferAttribute(
            mark.geometry.getAttribute("position"),
            0,
          );
          motionError = Math.max(
            motionError,
            mark.localToWorld(local.clone()).distanceTo(right.localToWorld(local)),
          );
        }
        if (!lodHit && left.geometry !== base) {
          stamp(left, 1.7, 1.7);
          lodHit = true;
        }
        frames += 1;
        if (frames % 30 === 0) console.info(`TN_DECAL_FIXTURE:${JSON.stringify(observation())}`);
      };
    }

    override exit(): void {
      this.#dispose();
      this.#dispose = () => {};
    }
  }
  return defineGame({
    camera: { far: 100, fov: 48, near: 0.1, projection: "perspective" },
    display: { maxFps: 60 },
    initialState: {},
    input: { motion: { keys: ["KeyM"] }, remove: { keys: ["KeyX"] }, reset: { keys: ["KeyR"] } },
    plugins: [playtest({ holdUntilAttached: true })],
    renderer: { preferWebGPU: true },
    scenes: { room: DecalRoom },
    seed: 11,
    start: "room",
  });
}
