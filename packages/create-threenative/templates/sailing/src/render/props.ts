// Generated for you. Geometry and surface choices for the sailing kit live in this file.
import { BoxGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, SphereGeometry } from "three";
import type { ISailingMaterials } from "./materials.js";

export function createShipModel(materials: ISailingMaterials): Group {
  const ship = new Group();
  const hull = new Mesh(new CylinderGeometry(0.66, 0.52, 2.25, 12), materials.hull);
  hull.rotation.x = Math.PI / 2;
  hull.position.y = 0.02;
  hull.scale.z = 1.1;
  hull.castShadow = true;

  const deck = new Mesh(new BoxGeometry(1.18, 0.08, 1.65), materials.deck);
  deck.position.y = 0.34;
  deck.castShadow = true;

  const mast = new Mesh(new CylinderGeometry(0.045, 0.07, 2.5, 8), materials.deck);
  mast.position.set(0, 1.48, 0.12);
  mast.castShadow = true;

  const sail = new Mesh(new PlaneGeometry(1.55, 2.05), materials.sail);
  sail.position.set(0.32, 1.35, 0.08);
  sail.rotation.y = Math.PI / 2;
  sail.castShadow = true;

  ship.add(hull, deck, mast, sail);
  return ship;
}

export function createBuoy(materials: ISailingMaterials): Group {
  const buoy = new Group();
  const body = new Mesh(new CylinderGeometry(0.22, 0.3, 0.75, 12), materials.buoy);
  body.position.y = 0.25;
  body.castShadow = true;
  const cap = new Mesh(new SphereGeometry(0.28, 12, 8), materials.buoy);
  cap.position.y = 0.67;
  cap.scale.y = 0.6;
  cap.castShadow = true;
  const flag = new Mesh(new PlaneGeometry(0.48, 0.25), materials.sail);
  flag.position.set(0.22, 1.02, 0);
  flag.rotation.y = Math.PI / 2;
  buoy.add(body, cap, flag);
  return buoy;
}

export function createIsland(materials: ISailingMaterials): Mesh {
  const island = new Mesh(new CylinderGeometry(8, 10, 1.5, 24), materials.island);
  island.position.set(-7, -0.88, -9);
  island.scale.z = 0.7;
  island.receiveShadow = true;
  return island;
}
