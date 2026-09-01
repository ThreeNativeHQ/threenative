function setShadowFlags(object, castShadow = true, receiveShadow = true) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = castShadow;
    child.receiveShadow = receiveShadow;
  });
}

function createColumn(THREE, materials, height = 11, radius = 1.05) {
  const group = new THREE.Group();
  group.name = 'StoneColumn';

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.5, radius * 1.65, 0.75, 12),
    materials.trim,
  );
  base.position.y = 0.375;
  group.add(base);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 1.22, radius * 1.42, 0.65, 12),
    materials.stone,
  );
  plinth.position.y = 1.05;
  group.add(plinth);

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.82, radius, height, 14, 1),
    materials.stone,
  );
  shaft.position.y = 1.35 + height * 0.5;
  group.add(shaft);

  const capital = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 2.7, 0.7, radius * 2.7),
    materials.trim,
  );
  capital.position.y = height + 1.7;
  group.add(capital);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 3.3, 0.36, radius * 3.3),
    materials.lightStone,
  );
  cap.position.y = height + 2.2;
  group.add(cap);
  return group;
}

function createTree(THREE, materials, seed = 0) {
  const group = new THREE.Group();
  group.name = 'CypressTree';

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.56, 5.6, 9),
    materials.wood,
  );
  trunk.position.y = 2.8;
  group.add(trunk);

  for (let tier = 0; tier < 3; tier += 1) {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(2.4 - tier * 0.42, 5.6 - tier * 0.35, 9),
      tier === 1 ? materials.foliageLight : materials.foliage,
    );
    crown.position.set(
      Math.sin(seed * 2.17 + tier) * 0.18,
      6.2 + tier * 2.15,
      Math.cos(seed * 1.71 + tier) * 0.16,
    );
    crown.rotation.y = seed * 0.7 + tier * 0.47;
    group.add(crown);
  }
  return group;
}

function createObelisk(THREE, materials, height = 12) {
  const group = new THREE.Group();
  group.name = 'ObeliskMonument';

  const base = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 4.2), materials.trim);
  base.position.y = 0.65;
  group.add(base);

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, height, 2.1), materials.darkStone);
  body.position.y = 1.3 + height * 0.5;
  body.scale.set(1, 1, 1);
  group.add(body);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.2, 4), materials.lightStone);
  tip.position.y = height + 2.9;
  tip.rotation.y = Math.PI * 0.25;
  group.add(tip);
  return group;
}

function addStepRun(THREE, parent, material, z, width = 30, rise = 0.42) {
  for (let step = 0; step < 5; step += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width + step * 1.2, rise, 3.1),
      material,
    );
    mesh.position.set(0, rise * 0.5 + step * rise, z - step * 2.7);
    parent.add(mesh);
  }
}

function createMovableCaster(THREE, materials) {
  const group = new THREE.Group();
  group.name = 'MovableCaster';

  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 3.4), materials.trim);
  pedestal.position.y = 0.55;
  group.add(pedestal);

  const body = new THREE.Mesh(new THREE.DodecahedronGeometry(1.7, 0), materials.bronze);
  body.position.y = 3.0;
  body.scale.set(0.8, 1.45, 0.8);
  body.rotation.set(0.22, 0.5, -0.16);
  group.add(body);

  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.22, 8, 24), materials.bronzeDark);
  halo.position.y = 5.3;
  halo.rotation.x = Math.PI * 0.5;
  group.add(halo);
  return group;
}

export function createAvenueScene(THREE, {
  scene = new THREE.Scene(),
  materialFactory,
  stock = false,
} = {}) {
  if (typeof materialFactory !== 'function') {
    throw new TypeError('materialFactory is required');
  }

  scene.name = stock ? 'StockShadowAvenue' : 'VirtualShadowAvenue';
  scene.background = new THREE.Color(0x8da2b4);
  if (stock) scene.fog = new THREE.FogExp2(0x8da2b4, 0.0062);

  const materials = {
    ground: materialFactory('ground', 0x4a5153, 0.96, 0, 0.18),
    path: materialFactory('path', 0x81817b, 0.86, 0, 0.22),
    stone: materialFactory('stone', 0x9b9690, 0.78, 0, 0.22),
    lightStone: materialFactory('light-stone', 0xb5afa4, 0.72, 0, 0.18),
    darkStone: materialFactory('dark-stone', 0x555962, 0.72, 0.05, 0.12),
    trim: materialFactory('trim', 0x706d69, 0.82, 0, 0.16),
    foliage: materialFactory('foliage', 0x244a38, 0.94, 0, 0.28),
    foliageLight: materialFactory('foliage-light', 0x3f6750, 0.9, 0, 0.24),
    wood: materialFactory('wood', 0x51382d, 0.9, 0, 0.18),
    bronze: materialFactory('bronze', 0x8b6534, 0.38, 0.72, 0.08),
    bronzeDark: materialFactory('bronze-dark', 0x4d392a, 0.3, 0.8, 0.06),
  };

  const receivers = [];
  const casters = [];

  const ground = new THREE.Mesh(new THREE.BoxGeometry(190, 1, 330), materials.ground);
  ground.name = 'GroundReceiver';
  ground.position.set(0, -0.55, -78);
  ground.receiveShadow = true;
  ground.castShadow = false;
  scene.add(ground);
  receivers.push(ground);

  const avenue = new THREE.Mesh(new THREE.BoxGeometry(31, 0.5, 292), materials.path);
  avenue.name = 'CentralAvenueReceiver';
  avenue.position.set(0, 0.0, -70);
  avenue.receiveShadow = true;
  avenue.castShadow = false;
  scene.add(avenue);
  receivers.push(avenue);

  const terraceLeft = new THREE.Mesh(new THREE.BoxGeometry(54, 1.8, 250), materials.darkStone);
  terraceLeft.position.set(-48, 0.35, -74);
  scene.add(terraceLeft);
  const terraceRight = terraceLeft.clone();
  terraceRight.position.x = 48;
  scene.add(terraceRight);
  receivers.push(terraceLeft, terraceRight);

  const nearArchitecture = new THREE.Group();
  nearArchitecture.name = 'NearColumnCourt';
  const midArchitecture = new THREE.Group();
  midArchitecture.name = 'MidColumnCourt';
  const farArchitecture = new THREE.Group();
  farArchitecture.name = 'FarColumnCourt';

  const columnRows = [29, 6, -18, -43, -69, -96, -124, -153];
  columnRows.forEach((z, index) => {
    const target = index < 3 ? nearArchitecture : index < 6 ? midArchitecture : farArchitecture;
    for (const x of [-20.5, 20.5]) {
      const column = createColumn(THREE, materials, 10.2 + index * 0.22, 1.0 + index * 0.015);
      column.position.set(x, 0.35, z);
      target.add(column);
    }

    if (index % 2 === 1) {
      const beam = new THREE.Mesh(
        new THREE.BoxGeometry(45, 1.2, 2.15),
        index > 4 ? materials.darkStone : materials.trim,
      );
      beam.name = index > 4 ? 'FarColonnadeBeam' : 'ColonnadeBeam';
      beam.position.set(0, 13.2 + index * 0.22, z);
      target.add(beam);
    }
  });

  addStepRun(THREE, nearArchitecture, materials.lightStone, 42, 34);
  addStepRun(THREE, midArchitecture, materials.stone, -80, 30);

  const nearObeliskLeft = createObelisk(THREE, materials, 11.5);
  nearObeliskLeft.position.set(-10.5, 0.28, 20);
  nearArchitecture.add(nearObeliskLeft);
  const nearObeliskRight = createObelisk(THREE, materials, 11.5);
  nearObeliskRight.position.set(10.5, 0.28, 20);
  nearArchitecture.add(nearObeliskRight);

  const farObelisk = createObelisk(THREE, materials, 18);
  farObelisk.name = 'FarObelisk';
  farObelisk.position.set(0, 0.32, -188);
  farArchitecture.add(farObelisk);

  const farTower = new THREE.Group();
  farTower.name = 'FarShadowTower';
  const towerBase = new THREE.Mesh(new THREE.BoxGeometry(28, 4.5, 20), materials.darkStone);
  towerBase.position.y = 2.25;
  farTower.add(towerBase);
  const towerBody = new THREE.Mesh(new THREE.BoxGeometry(17, 26, 13), materials.stone);
  towerBody.position.y = 17.5;
  farTower.add(towerBody);
  const towerCap = new THREE.Mesh(new THREE.ConeGeometry(12, 13, 4), materials.lightStone);
  towerCap.position.y = 37;
  towerCap.rotation.y = Math.PI * 0.25;
  farTower.add(towerCap);
  farTower.position.set(0, 0.2, -222);
  farArchitecture.add(farTower);

  scene.add(nearArchitecture, midArchitecture, farArchitecture);
  casters.push(nearArchitecture, midArchitecture, farArchitecture);

  const leftTrees = new THREE.Group();
  leftTrees.name = 'LeftTreeLine';
  const rightTrees = new THREE.Group();
  rightTrees.name = 'RightTreeLine';
  const treeZ = [38, 14, -11, -37, -64, -92, -121, -151, -183];
  treeZ.forEach((z, index) => {
    const leftTree = createTree(THREE, materials, index + 0.31);
    leftTree.position.set(-35 - (index % 2) * 4, 1.25, z + Math.sin(index) * 2.2);
    leftTree.scale.setScalar(0.9 + (index % 3) * 0.07);
    leftTrees.add(leftTree);

    const rightTree = createTree(THREE, materials, index + 4.87);
    rightTree.position.set(35 + (index % 2) * 4, 1.25, z - Math.cos(index) * 2.3);
    rightTree.scale.setScalar(0.92 + ((index + 1) % 3) * 0.07);
    rightTrees.add(rightTree);
  });
  scene.add(leftTrees, rightTrees);
  casters.push(leftTrees, rightTrees);

  const rocks = new THREE.Group();
  rocks.name = 'AvenueBoulders';
  for (let index = 0; index < 12; index += 1) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.4 + (index % 4) * 0.32, 0),
      index % 2 ? materials.darkStone : materials.trim,
    );
    const side = index % 2 === 0 ? -1 : 1;
    rock.position.set(
      side * (28 + (index % 3) * 7),
      1.25 + (index % 2) * 0.3,
      33 - index * 18.4,
    );
    rock.rotation.set(index * 0.37, index * 0.71, index * 0.19);
    rock.scale.y = 0.65 + (index % 3) * 0.13;
    rocks.add(rock);
  }
  scene.add(rocks);
  casters.push(rocks);

  const movableCaster = createMovableCaster(THREE, materials);
  movableCaster.position.set(-5.5, 0.26, -26);
  scene.add(movableCaster);
  casters.push(movableCaster);

  for (const caster of casters) setShadowFlags(caster, true, true);
  setShadowFlags(ground, false, true);
  setShadowFlags(avenue, false, true);
  setShadowFlags(terraceLeft, true, true);
  setShadowFlags(terraceRight, true, true);
  casters.push(terraceLeft, terraceRight);

  return {
    scene,
    materials,
    casters,
    receivers,
    movableCaster,
    cameraTarget: new THREE.Vector3(0, 5.5, -74),
  };
}
