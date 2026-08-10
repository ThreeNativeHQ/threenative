import { assertCondition, startVisualScene, THREE } from "./scene-support.js";

export async function advanceRotationWithRaf(subject, scheduleFrame) {
  const initialRotation = subject.rotation.y;
  const timestamps = [];
  await new Promise((resolve) => {
    function advance(timestamp) {
      timestamps.push(timestamp);
      subject.rotation.y += Math.PI / 12;
      if (timestamps.length === 3) resolve();
      else scheduleFrame(advance);
    }
    scheduleFrame(advance);
  });
  assertCondition(
    timestamps.every(Number.isFinite) &&
      timestamps[0] <= timestamps[1] &&
      timestamps[1] <= timestamps[2],
    "requestAnimationFrame must provide three finite monotonic timestamps",
  );
  assertCondition(
    Math.abs(subject.rotation.y - initialRotation - Math.PI / 4) < 1e-6,
    "requestAnimationFrame callbacks must advance rotation three times",
  );
  return timestamps;
}

export async function startScene(canvas, dimensions) {
  const subject = new THREE.Group();
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.34, 0.32),
    new THREE.MeshBasicMaterial({ color: 0x56cfe1 }),
  );
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xff5d8f }),
  );
  marker.position.x = 0.72;
  subject.add(bar, marker);
  const timestamps = await advanceRotationWithRaf(subject, (callback) =>
    requestAnimationFrame(callback),
  );
  return startVisualScene(canvas, dimensions, "raf-rotation", ({ scene }) => {
    scene.add(subject);
    return { detail: { callbacks: timestamps.length, rotationY: subject.rotation.y }, subject };
  });
}
