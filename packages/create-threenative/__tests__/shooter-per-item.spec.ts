import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createFirstPersonRig } from "../templates/shooter/src/render/camera.js";

const PLAY_SOURCE = readFileSync(
  fileURLToPath(new URL("../templates/shooter/src/scenes/Play.ts", import.meta.url)),
  "utf8",
);
const CAMERA_SOURCE = readFileSync(
  fileURLToPath(new URL("../templates/shooter/src/render/camera.ts", import.meta.url)),
  "utf8",
);

describe("shooter per-item consumers", () => {
  it("uses an unrestricted camera-facing billboard for a target nameplate", () => {
    expect(PLAY_SOURCE).toContain("new Billboard3D(nameplate, { camera })");
    expect(PLAY_SOURCE).toContain("nameplateFacingCamera");
    expect(PLAY_SOURCE).toMatch(/for \(const billboard of billboards\) billboard\.update\(\);/u);
  });

  it("observes camera-relative up", () => {
    expect(PLAY_SOURCE).toContain("camera.getWorldQuaternion(billboardCameraQuaternion);");
    expect(PLAY_SOURCE).toContain("projectOnPlane(billboardExpected)");
    expect(PLAY_SOURCE).toMatch(
      /const nameplateFacingCamera =\s*billboardFront\.dot\(billboardExpected\) >= 0\.999 &&\s*billboardUp\.dot\(billboardExpectedUp\) >= 0\.999\s*\? 1\s*:\s*0;/u,
    );
  });

  it("routes the complete shake offset through one composition operation", () => {
    expect(CAMERA_SOURCE).toContain("composeCameraShake(camera, shakeOffset);");
  });

  it("applies both position and rotation from a camera shake consumer", () => {
    // The first-person rig does not choose where the eye is; the player does, through
    // `syncCamera`. This stub stands in for that, so what is measured here is only the shake the
    // rig composes on top of whatever pose it was handed.
    const eyeAt = (camera: PerspectiveCamera) => ({
      syncCamera: () => camera.position.set(0, 1.66, 5),
    });
    const steadyCamera = new PerspectiveCamera(45, 1, 0.1, 100);
    createFirstPersonRig(steadyCamera).follow(eyeAt(steadyCamera), 1 / 60);

    const shakenCamera = new PerspectiveCamera(45, 1, 0.1, 100);
    const position = new Vector3(0.25, -0.1, 0.05);
    const rotation = new Vector3(0.04, -0.03, 0.02);
    createFirstPersonRig(shakenCamera, {
      update: () => ({ position, rotation }),
    }).follow(eyeAt(shakenCamera), 1 / 60);

    expect(shakenCamera.position.distanceTo(steadyCamera.position)).toBeCloseTo(
      position.length(),
      6,
    );
    expect(shakenCamera.quaternion.angleTo(steadyCamera.quaternion)).toBeGreaterThan(0.01);
  });

  it("leaves a respawn snap unshaken", () => {
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    const eye = { syncCamera: () => camera.position.set(0, 1.66, 5) };
    createFirstPersonRig(camera, {
      update: () => ({
        position: new Vector3(0.5, 0.5, 0.5),
        rotation: new Vector3(0.2, 0.2, 0.2),
      }),
    }).snap(eye);

    expect(camera.position.toArray()).toEqual([0, 1.66, 5]);
    expect(camera.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });
});
