import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
} from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DiscreteLodPlugin,
  TN_DISCRETE_LOD,
  baseGeometryOf,
  isLodJoinProxy,
  updateModelLods,
} from "../src/model-lod.js";
import { ScenePicker } from "../src/picking.js";

// PRD-377 §4.4/§6 — runtime selection of the opt-in joined far rung.
//
// The join is a draw-topology change: one joined object replaces many authored primitives. This
// suite proves the selection authority hides the authored primitives and shows the joined proxy as
// one unit, reversibly, and refuses the rung for anything the bake's safety gate cannot guarantee.

const SCHEMA = 1;
const LOD0_TRIANGLES = 6;
const LEVEL_ONE_TRIANGLES = 4;

const BASE_INDICES = [0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3, 0, 2, 1, 3, 1, 2];
const LEVEL_INDICES = [
  [0, 1, 2, 1, 3, 2, 1, 4, 3, 4, 5, 3],
  [0, 1, 2, 1, 3, 2],
];

function baseGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 2, 0, 0, 2, 0, 1]);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(Uint32Array.from(BASE_INDICES), 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function prototype(): Group {
  const group = new Group();
  group.name = "hull__lod_join";
  for (let index = 0; index < 2; index += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array([0, 0, index, 1, 0, index, 0, 1, index]), 3),
    );
    geometry.setIndex(new BufferAttribute(Uint32Array.from([0, 1, 2]), 1));
    geometry.computeBoundingSphere();
    group.add(new Mesh(geometry, undefined));
  }
  return group;
}

function definition(): Record<string, unknown> {
  return {
    absoluteErrors: [0.05, 5],
    counts: [LEVEL_ONE_TRIANGLES, 2],
    errors: [0.05, 5],
    indices: [0, 1],
    lod0Triangles: LOD0_TRIANGLES,
    schemaVersion: SCHEMA,
    sharedVertexBuffers: true,
    strategy: "discrete",
  };
}

interface IFixture {
  readonly container: Group;
  readonly members: readonly [Mesh, Mesh];
  readonly parser: Record<string, unknown>;
}

interface IFixtureOptions {
  readonly joined?: boolean;
  readonly rungError?: number;
  readonly animated?: boolean;
  readonly skinned?: boolean;
  readonly morphed?: boolean;
  /** A join-only cook (`maxLevels: 1`) writes no per-primitive discrete chain at all. */
  readonly chainless?: boolean;
}

function fixture(options: IFixtureOptions = {}): IFixture {
  const container = new Group();
  container.name = "hull";
  const members: [Mesh, Mesh] = [
    new Mesh(baseGeometry(), undefined),
    new Mesh(baseGeometry(), undefined),
  ];
  for (const member of members) container.add(member);
  if (options.skinned === true)
    (members[0] as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh = true;
  if (options.morphed === true)
    members[0].geometry.morphAttributes.position = [new BufferAttribute(new Float32Array(9), 3)];

  const associations = new Map<object, Record<string, number>>();
  associations.set(container, { meshes: 0, nodes: 0 });
  members.forEach((member, index) =>
    associations.set(member, { meshes: 0, nodes: 0, primitives: index }),
  );

  const rung =
    options.joined === false
      ? undefined
      : [
          {
            draws: 2,
            error: options.rungError ?? 0.05,
            mesh: "hull__lod_join",
            primitives: 2,
            sources: ["hull#0", "hull#1"],
            triangles: 2,
          },
        ];

  const json = {
    animations: options.animated === true ? [{ channels: [{ target: { node: 0 } }] }] : undefined,
    extensions: rung === undefined ? undefined : { [TN_DISCRETE_LOD]: { joined: rung } },
    meshes: [
      {
        name: "hull",
        primitives: members.map(() =>
          options.chainless === true ? {} : { extensions: { [TN_DISCRETE_LOD]: definition() } },
        ),
      },
      { name: "hull__lod_join", primitives: [{}, {}] },
    ],
  };

  const getDependency = async (type: string, index: number) => {
    if (type === "mesh") return prototype();
    return { array: Uint32Array.from(LEVEL_INDICES[index] ?? []) };
  };

  return { container, members, parser: { associations, getDependency, json } };
}

async function attached(
  target: IFixture,
  options: { readonly policy?: { hysteresis: number; maxPixelError: number } } = {},
): Promise<number> {
  const plugin = new DiscreteLodPlugin();
  plugin.setParser(target.parser as never);
  await plugin.afterRoot({ scene: target.container });
  return plugin.attach(target.container, options.policy ?? { hysteresis: 0.15, maxPixelError: 1 });
}

function farCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 100);
  camera.updateMatrixWorld(true);
  return camera;
}

function nearCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.position.set(0, 0, 3);
  camera.updateMatrixWorld(true);
  return camera;
}

function proxies(container: Group): Group[] {
  return container.children.filter((child): child is Group => child instanceof Group);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("joined far rung runtime selection", () => {
  it("selects the joined rung beyond the error budget and collapses the draw count", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const target = fixture();
    expect(await attached(target)).toBe(2);

    const scene = new Scene();
    scene.add(target.container);
    const triangles = updateModelLods(scene, farCamera(), 1080);

    // The joined rung submits its own (coarser) triangles and the authored primitives submit none.
    expect(triangles).toBe(2);
    expect(target.members.every((member) => member.visible === false)).toBe(true);
    const proxy = proxies(target.container);
    expect(proxy).toHaveLength(1);
    expect(proxy[0]?.children.filter((child) => child instanceof Mesh)).toHaveLength(2);
    // The draw count the rung collapsed is named in the diagnostic, once.
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("TN_DISCRETE_LOD_JOINED"));
    expect(info).toHaveBeenCalledWith(expect.stringContaining("2 draw"));
  });

  it("reverts to the authored primitives when the camera closes, preserving authored state", async () => {
    const target = fixture();
    await attached(target);
    // Authored per-node state the game owns.
    target.container.position.set(3, 1, -2);
    target.members[0].renderOrder = 7;
    target.members[1].renderOrder = 3;
    target.members[1].visible = false;

    const scene = new Scene();
    scene.add(target.container);
    const far = farCamera();
    updateModelLods(scene, far, 1080);
    expect(target.members[0].visible).toBe(false);
    expect(proxies(target.container)).toHaveLength(1);

    updateModelLods(scene, nearCamera(), 1080);
    expect(proxies(target.container)).toHaveLength(0);
    // Authored visibility is restored exactly (member 1 was authored hidden).
    expect(target.members[0].visible).toBe(true);
    expect(target.members[1].visible).toBe(false);
    // Node identity, transform and render order are untouched.
    expect(target.container.position.toArray()).toEqual([3, 1, -2]);
    expect(target.members[0].renderOrder).toBe(7);
    expect(target.members[1].renderOrder).toBe(3);
    expect(target.members[0].geometry.index?.count).toBe(LOD0_TRIANGLES * 3);
    expect(baseGeometryOf(target.members[0]).index?.count).toBe(LOD0_TRIANGLES * 3);
  });

  it("never selects the joined rung for a node targeted by an animation", async () => {
    const target = fixture({ animated: true });
    await attached(target);
    const scene = new Scene();
    scene.add(target.container);
    // The rung was refused, so the discrete chain selects instead and the members stay drawn.
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(target.members.every((member) => member.visible === true)).toBe(true);
    expect(proxies(target.container)).toHaveLength(0);
  });

  it("never selects the joined rung for skinned or morphed primitives", async () => {
    for (const options of [{ skinned: true }, { morphed: true }]) {
      const target = fixture(options);
      await attached(target);
      const scene = new Scene();
      scene.add(target.container);
      updateModelLods(scene, farCamera(), 1080);
      expect(proxies(target.container)).toHaveLength(0);
    }
  });

  it("makes a clone of a joined-rung model behave like its source", async () => {
    const target = fixture();
    await attached(target);
    const clone = target.container.clone(true) as Group;

    const scene = new Scene();
    scene.add(target.container);
    scene.add(clone);
    const far = farCamera();
    updateModelLods(scene, far, 1080);
    expect(proxies(target.container)).toHaveLength(1);
    expect(proxies(clone)).toHaveLength(1);

    updateModelLods(scene, nearCamera(), 1080);
    expect(proxies(target.container)).toHaveLength(0);
    expect(proxies(clone)).toHaveLength(0);
    const clonedMember = clone.children.find((child) => child instanceof Mesh) as Mesh;
    expect(baseGeometryOf(clonedMember)).toBe(baseGeometryOf(target.members[0] as Mesh));
  });

  it("keeps per-instance choices independent when instances sit at different distances", async () => {
    const target = fixture();
    await attached(target);
    const near = target.container;
    near.position.set(0, 0, 97);
    const far = target.container.clone(true) as Group;
    far.position.set(0, 0, -97);

    const scene = new Scene();
    scene.add(near);
    scene.add(far);
    scene.updateMatrixWorld(true);
    updateModelLods(scene, farCamera(), 1080);

    expect(proxies(far)).toHaveLength(1);
    expect(proxies(near)).toHaveLength(0);
    expect(near.children.some((child) => child instanceof Mesh && child.visible)).toBe(true);
  });

  it("recomputes from each camera it is handed without a stale pass-local choice", async () => {
    const target = fixture();
    await attached(target);
    const scene = new Scene();
    scene.add(target.container);

    updateModelLods(scene, farCamera(), 1080);
    expect(proxies(target.container)).toHaveLength(1);
    updateModelLods(scene, nearCamera(), 1080);
    expect(proxies(target.container)).toHaveLength(0);
    updateModelLods(scene, farCamera(), 1080);
    expect(proxies(target.container)).toHaveLength(1);
  });

  it("keeps picking on the authored primitives while the joined rung is drawn", async () => {
    const target = fixture();
    await attached(target);
    const scene = new Scene();
    scene.add(target.container);
    updateModelLods(scene, farCamera(), 1080);
    const proxy = proxies(target.container)[0];
    expect(proxy).toBeDefined();
    expect(isLodJoinProxy(proxy as Group)).toBe(true);

    const picker = new ScenePicker({
      camera: farCamera(),
      pointer: () => new Vector2(0, 0),
      scene,
      viewport: { size: { height: 720, width: 1280 } } as never,
    });
    const hit = picker.raycast({
      direction: new Vector3(0, -0.01, -1).normalize(),
      origin: new Vector3(1, 1, 100),
    });
    // The hit is an authored member, never the joined proxy the runtime inserted.
    expect(hit).toBeDefined();
    expect(target.members).toContain(hit?.object);
  });

  it("joins a cook that wrote no discrete chain at all", async () => {
    const target = fixture({ chainless: true, rungError: 0 });
    // No per-primitive chains, so the discrete pass applied nothing; the runtime still manages the
    // members through the minimal chain it registers for the rung.
    expect(await attached(target)).toBe(0);
    const scene = new Scene();
    scene.add(target.container);
    // A merged-but-unreduced rung has zero error, so even a close view may select the cheaper draw.
    expect(updateModelLods(scene, nearCamera(), 1080)).toBe(2);
    expect(proxies(target.container)).toHaveLength(1);
  });

  it("is byte-identical to today when the cook wrote no joined rung", async () => {
    const target = fixture({ joined: false });
    expect(await attached(target)).toBe(2);
    const scene = new Scene();
    scene.add(target.container);
    // Same discrete choice and same geometry swap as the plain chain path.
    expect(updateModelLods(scene, farCamera(), 1080)).toBe(LEVEL_ONE_TRIANGLES * 2);
    expect(proxies(target.container)).toHaveLength(0);
    expect(target.members[0].visible).toBe(true);
    expect(target.members[0].geometry.index?.count).toBe(LEVEL_ONE_TRIANGLES * 3);
  });
});
