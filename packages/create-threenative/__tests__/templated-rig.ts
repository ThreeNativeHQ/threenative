import {
  AnimationClip,
  Bone,
  BoxGeometry,
  BufferAttribute,
  Group,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  VectorKeyframeTrack,
} from "three";

/**
 * The smallest skinned rig that satisfies `requiredClips`, carrying the bone names a template's
 * conventions reach for: a crown `Head` to measure height from, and the right hand a held prop is
 * attached to.
 *
 * The packaged combat mannequin is 1.6 MB and needs a loader, a WASM-adjacent asset pipeline and
 * a GPU to read; a box on two bones proves the same three conventions — scale, ground contact and
 * bone attachment — in a millisecond and with no bytes. `hand_r` is the name that rig actually
 * uses, so a convention that binds to it here binds to it there.
 */
export function templatedRig(clipNames: readonly string[]): {
  scene: Group;
  animations: AnimationClip[];
} {
  const root = new Bone();
  root.name = "root";
  const head = new Bone();
  head.name = "Head";
  head.position.y = 1.5;
  root.add(head);
  const hand = new Bone();
  hand.name = "hand_r";
  hand.position.set(0.2, 1.3, 0);
  head.add(hand);
  const geometry = new BoxGeometry(0.4, 1.8, 0.3).translate(0, 0.9, 0);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new BufferAttribute(new Uint16Array(count * 4), 4));
  const weights = new Float32Array(count * 4);
  for (let index = 0; index < count; index += 1) weights[index * 4] = 1;
  geometry.setAttribute("skinWeight", new BufferAttribute(weights, 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  mesh.add(root);
  mesh.bind(new Skeleton([root, head, hand]));
  const scene = new Group();
  scene.add(mesh);
  const animations = clipNames.map(
    (name) =>
      new AnimationClip(name, 1, [
        new VectorKeyframeTrack("Head.position", [0, 1], [0, 1.5, 0, 0, 1.5, 0]),
      ]),
  );
  return { scene, animations };
}
