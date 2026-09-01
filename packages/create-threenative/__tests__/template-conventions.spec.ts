import { GroundSnap } from "@threenative/core";
import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { preparePlayerConventions as prepareRpgConventions } from "../templates/action-rpg/src/conventions.js";
import { createMaterials as createRpgMaterials } from "../templates/action-rpg/src/render/materials.js";
import { createPlayerVisual as createRpgVisual } from "../templates/action-rpg/src/render/shapes.js";
import { prepareCommanderConventions } from "../templates/defense/src/conventions.js";
import { commander } from "../templates/defense/src/render/shapes.js";
import { preparePlayerConventions as prepareMinimalConventions } from "../templates/minimal/src/conventions.js";
import { prepareCharacterConventions } from "../templates/platformer/src/conventions.js";
import { createCharacterRig } from "../templates/platformer/src/render/rig.js";
import { prepareVehicleConventions } from "../templates/racing/src/conventions.js";
import { createMaterials as createRacingMaterials } from "../templates/racing/src/render/materials.js";
import { vehicle } from "../templates/racing/src/render/shapes.js";
import { prepareShipConventions } from "../templates/sailing/src/conventions.js";
import { createMaterials as createSailingMaterials } from "../templates/sailing/src/render/materials.js";
import { createShipModel } from "../templates/sailing/src/render/props.js";
import { preparePlayerConventions as prepareShooterConventions } from "../templates/shooter/src/conventions.js";
import { createMaterials as createShooterMaterials } from "../templates/shooter/src/render/materials.js";
import { createPlayerVisual as createShooterVisual } from "../templates/shooter/src/render/shapes.js";
import { preparePlayerConventions as prepareStarterConventions } from "../templates/starter/src/conventions.js";

const FRAME = 1 / 60;

function expectFactor(factor: number): void {
  expect(Number.isFinite(factor)).toBe(true);
  expect(Math.abs(factor - 1)).toBeGreaterThan(0.0001);
}

function expectGrounding(
  model: Object3D,
  conventions: {
    readonly applyGrounding: (surfaceY: number, dt: number) => void;
    readonly groundSnap: GroundSnap;
  },
): void {
  model.position.y = 0.5;
  const disabledMeasurement = new GroundSnap(model, { enabled: false });
  disabledMeasurement.apply(model, 0, FRAME);
  const before = disabledMeasurement.clearance;
  conventions.applyGrounding(0, FRAME);
  const after = conventions.groundSnap.clearance;
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  if (before === null || after === null) throw new Error("Grounding did not report clearance.");
  expect(Number.isFinite(after)).toBe(true);
  expect(Math.abs(after)).toBeLessThan(Math.abs(before));
}

describe("generated template conventions", () => {
  it("grounds, scales, and attaches the action-rpg player", () => {
    const model = createRpgVisual(createRpgMaterials());
    const conventions = prepareRpgConventions(model);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.boneNames).toContain("RightHand");
    expect(conventions.attachedBone).toBe("RightHand");
    expectGrounding(model, conventions);
  });

  it("grounds and scales the defense commander", () => {
    const model = commander();
    const conventions = prepareCommanderConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });

  it("measures disabled grounding while scaling the minimal player", () => {
    const model = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshBasicMaterial());
    const conventions = prepareMinimalConventions(model);
    const beforeY = 0.5;
    model.position.y = beforeY;
    conventions.applyGrounding(0, FRAME);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.groundSnap.clearance).not.toBeNull();
    expect(Number.isFinite(conventions.groundSnap.clearance)).toBe(true);
    expect(model.position.y).toBe(beforeY);
  });

  it("grounds and scales the platformer procedural character", () => {
    const model = createCharacterRig().root;
    const conventions = prepareCharacterConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });

  it("scales the racing vehicle", () => {
    const model = vehicle(createRacingMaterials());

    expectFactor(prepareVehicleConventions(model));
  });

  it("scales the sailing ship", () => {
    const model = createShipModel(createSailingMaterials());

    expectFactor(prepareShipConventions(model));
  });

  it("grounds, scales, and attaches the shooter player", () => {
    const model = createShooterVisual(createShooterMaterials());
    const conventions = prepareShooterConventions(model);

    expectFactor(conventions.normaliseFactor);
    expect(conventions.boneNames).toContain("RightHand");
    expect(conventions.attachedBone).toBe("RightHand");
    expectGrounding(model, conventions);
  });

  it("grounds and scales the starter player", () => {
    const model = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshBasicMaterial());
    const conventions = prepareStarterConventions(model);

    expectFactor(conventions.normaliseFactor);
    expectGrounding(model, conventions);
  });
});
