import * as THREE from "three";
import { ball, block, spike } from "../render/shapes.js";
import { palette, standard } from "../render/materials.js";

function shadowEverything(root: THREE.Object3D): void {
  root.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;
  });
}

export class Player {
  readonly group = new THREE.Group();
  readonly mesh = this.group;
  readonly velocity = new THREE.Vector3();
  grounded = true;
  jumpBuffer = 0;
  coyoteTime = 0;

  private readonly legs: THREE.Object3D[] = [];
  private readonly tail: THREE.Group;
  private readonly body: THREE.Object3D;
  private animTime = 0;

  constructor() {
    this.group.name = "player";

    this.body = block(1.18, 0.92, 1.1, standard(palette.fox), 0.28);
    this.body.position.set(0, 1.02, 0);
    this.group.add(this.body);

    const belly = block(0.72, 0.54, 0.16, standard(palette.foxLight), 0.14);
    belly.position.set(0, 0.98, -0.57);
    this.group.add(belly);

    const head = ball(0.63, standard(palette.fox));
    head.scale.set(1, 0.95, 0.94);
    head.position.set(0, 1.85, -0.08);
    this.group.add(head);

    const muzzle = ball(0.3, standard(palette.foxLight));
    muzzle.scale.set(1.15, 0.72, 0.72);
    muzzle.position.set(0, 1.7, -0.6);
    this.group.add(muzzle);

    const nose = ball(0.1, standard(palette.ink));
    nose.position.set(0, 1.73, -0.83);
    this.group.add(nose);

    const leftEye = ball(0.07, standard(palette.ink, { roughness: 0.35 }));
    const rightEye = ball(0.07, standard(palette.ink, { roughness: 0.35 }));
    leftEye.position.set(-0.23, 1.94, -0.6);
    rightEye.position.set(0.23, 1.94, -0.6);
    this.group.add(leftEye, rightEye);

    for (const x of [-0.34, 0.34]) {
      const ear = spike(0.3, 0.58, standard(palette.foxDark));
      ear.position.set(x, 2.37, -0.04);
      ear.scale.z = 0.8;
      this.group.add(ear);

      const innerEar = spike(0.14, 0.3, standard(palette.foxLight));
      innerEar.position.set(x, 2.4, -0.17);
      innerEar.scale.z = 0.8;
      this.group.add(innerEar);
    }

    const backpack = block(0.78, 0.8, 0.32, standard(palette.backpack), 0.16);
    backpack.position.set(0, 1.28, 0.56);
    this.group.add(backpack);
    const packCap = ball(0.22, standard(palette.backpackLight));
    packCap.scale.set(1.2, 0.75, 0.5);
    packCap.position.set(0, 1.64, 0.72);
    this.group.add(packCap);

    this.tail = new THREE.Group();
    this.tail.position.set(0.55, 1.02, 0.35);
    this.tail.rotation.z = -0.45;
    const tailBase = ball(0.42, standard(palette.fox));
    tailBase.scale.set(0.9, 1.15, 1.35);
    tailBase.position.set(0, 0.12, 0);
    this.tail.add(tailBase);
    const tailTip = ball(0.3, standard(palette.foxLight));
    tailTip.position.set(0.02, 0.5, 0.02);
    this.tail.add(tailTip);
    this.group.add(this.tail);

    for (const x of [-0.36, 0.36]) {
      for (const z of [-0.3, 0.3]) {
        const leg = block(0.27, 0.72, 0.32, standard(palette.foxDark), 0.11);
        leg.position.set(x, 0.43, z);
        this.legs.push(leg);
        this.group.add(leg);

        const paw = ball(0.21, standard(palette.foxLight));
        paw.scale.set(1.1, 0.65, 1.3);
        paw.position.set(x, 0.1, z - 0.03);
        this.group.add(paw);
      }
    }

    shadowEverything(this.group);
  }

  reset(position: THREE.Vector3): void {
    this.group.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = true;
    this.jumpBuffer = 0;
    this.coyoteTime = 0.12;
  }

  updateVisual(dt: number, moving: boolean, won: boolean): void {
    this.animTime += dt;
    const speed = moving ? 11 : 2.1;
    const stride = moving && this.grounded ? Math.sin(this.animTime * speed) * 0.22 : 0;
    this.legs.forEach((leg, index) => {
      const phase = index % 2 === 0 ? 1 : -1;
      leg.position.y = 0.43 + Math.max(0, stride * phase) * 0.28;
      leg.rotation.x = stride * phase * 0.65;
    });
    this.tail.rotation.z = -0.45 + Math.sin(this.animTime * 3.2) * 0.12;
    const bob = won ? Math.sin(this.animTime * 5) * 0.12 : 0;
    this.group.position.y += (bob - (this.group.userData.lastBob ?? 0)) as number;
    this.group.userData.lastBob = bob;
    if (won) this.group.rotation.y += dt * 2.3;
  }

  faceVelocity(): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.05) return;
    const desired = Math.atan2(this.velocity.x, -this.velocity.z);
    const delta = Math.atan2(Math.sin(desired - this.group.rotation.y), Math.cos(desired - this.group.rotation.y));
    this.group.rotation.y += delta * 0.16;
  }

  debug(): Record<string, unknown> {
    return {
      position: [
        Number(this.group.position.x.toFixed(3)),
        Number(this.group.position.y.toFixed(3)),
        Number(this.group.position.z.toFixed(3)),
      ],
      grounded: this.grounded,
      velocityY: Number(this.velocity.y.toFixed(3)),
      tags: ["player", "character"],
    };
  }
}
