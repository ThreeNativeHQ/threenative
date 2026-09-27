import { type ICtx, Scene } from "@threenative/core";
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  CylinderGeometry,
  Float32BufferAttribute,
  Mesh,
  NumberKeyframeTrack,
  type PerspectiveCamera,
  PlaneGeometry,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from "three";
import { crowdLook } from "../render/look.js";

const SIDE = 8;
const SPACING = 1.4;
const BONES = 12;
const HEIGHT = 2;
const SWAY_SECONDS = 2;

/** A tube bound to a chain of bones, so a bend of the chain bends the tube. */
function tube(): CylinderGeometry {
  const geometry = new CylinderGeometry(0.22, 0.3, HEIGHT, 12, 22);
  const position = geometry.getAttribute("position");
  const indices: number[] = [];
  const weights: number[] = [];
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const along = ((position.getY(vertex) + HEIGHT / 2) / HEIGHT) * (BONES - 1);
    const bone = Math.min(Math.floor(along), BONES - 2);
    const blend = along - bone;
    indices.push(bone, bone + 1, 0, 0);
    weights.push(1 - blend, blend, 0, 0);
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
  return geometry;
}

/** One sway cycle: every bone bends the same way, so the whole chain curls and returns. */
function swayClip(): AnimationClip {
  const tracks: NumberKeyframeTrack[] = [];
  for (let bone = 1; bone < BONES; bone += 1) {
    tracks.push(
      new NumberKeyframeTrack(
        `bone${bone}.rotation[z]`,
        [0, SWAY_SECONDS / 2, SWAY_SECONDS],
        [-0.09, 0.09, -0.09],
      ),
    );
  }
  return new AnimationClip("sway", SWAY_SECONDS, tracks);
}

function rig(geometry: CylinderGeometry, material: SkinnedMesh["material"]): SkinnedMesh {
  const bones: Bone[] = [];
  for (let index = 0; index < BONES; index += 1) {
    const bone = new Bone();
    bone.name = `bone${index}`;
    bone.position.y = index === 0 ? -HEIGHT / 2 : HEIGHT / (BONES - 1);
    bones[index - 1]?.add(bone);
    bones.push(bone);
  }
  const mesh = new SkinnedMesh(geometry, material);
  mesh.add(bones[0] as Bone);
  mesh.bind(new Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class Crowd extends Scene {
  override enter(ctx: ICtx) {
    const extent = (SIDE * SPACING) / 2 + 1;
    const camera = ctx.camera as PerspectiveCamera;
    camera.position.set(0, 7, 11);
    camera.lookAt(0, 0, 0);
    ctx.add(camera);
    const look = crowdLook(ctx.scene, ctx.renderer.raw as never, extent);

    const ground = new Mesh(new PlaneGeometry(extent * 2, extent * 2), look.ground);
    ground.name = "ground";
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -HEIGHT / 2;
    ground.receiveShadow = true;
    ctx.add(ground);

    const geometry = tube();
    const clip = swayClip();
    const mixers: { mixer: AnimationMixer; phase: number }[] = [];
    for (let index = 0; index < SIDE * SIDE; index += 1) {
      const mesh = rig(geometry, look.skin);
      mesh.name = `walker-${index}`;
      mesh.position.set(
        ((index % SIDE) - (SIDE - 1) / 2) * SPACING,
        0,
        (Math.floor(index / SIDE) - (SIDE - 1) / 2) * SPACING,
      );
      mesh.rotation.y = index * 0.37;
      ctx.add(mesh);
      const mixer = new AnimationMixer(mesh);
      mixer.clipAction(clip).play();
      mixers.push({ mixer, phase: (index * 0.29) % SWAY_SECONDS });
    }

    // Posed by rendered frame rather than wall time, so every platform's capture of frame N shows
    // the same crowd and a cross-platform pixel comparison compares like with like.
    let frames = 0;
    ctx.beforeRender(() => {
      frames += 1;
      for (const { mixer, phase } of mixers) mixer.setTime(phase + frames / 60);
    });
  }
}
