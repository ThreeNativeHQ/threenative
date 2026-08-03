/**
 * ABYSS — a small game on three.js WebGPURenderer.
 *
 * The plankton field is a TSL compute shader: one dispatch per frame moves
 * every particle on the GPU, and nothing about them ever touches the CPU.
 * Gameplay entities (lure, pearls, hunters) are ordinary meshes — there are a
 * couple of dozen, so the CPU is the right place for them.
 */

import * as THREE from 'three/webgpu';
import {
  Fn, instancedArray, instanceIndex, uniform, uv, vec2, vec3, vec4, float,
  hash, mix, sin, cos, time, deltaTime, pass, If,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const PLANKTON = 90000;

const el = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('en-US');
const clock = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

const veil = el('veil');
const card = el('card');
const hud = el('hud');

el('agentBoast').textContent = fmt.format(PLANKTON);
el('agentCount').textContent = fmt.format(PLANKTON);

function fail(html) {
  card.innerHTML =
    '<div class="eyebrow">signal lost</div><h2>No WebGPU</h2>' +
    '<p class="lede fail">' + html + '</p>';
  veil.hidden = false;
}

/* ------------------------------------------------------------------ scene */

async function main() {
  if (!navigator.gpu) {
    fail('This browser has no <code>navigator.gpu</code>. Chrome or Edge 113+, or Safari 26+. Firefox needs <code>dom.webgpu.enabled</code>.');
    return;
  }

  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x04080d, 1);
  document.body.appendChild(renderer.domElement);

  try {
    await renderer.init();
  } catch (e) {
    fail('WebGPU failed to start: <code>' + (e?.message ?? e) + '</code>');
    return;
  }

  const scene = new THREE.Scene();
  const VIEW = 520;                       // world units from centre to top edge
  const camera = new THREE.OrthographicCamera(-VIEW, VIEW, VIEW, -VIEW, 1, 4000);
  camera.position.z = 1200;

  const field = { w: VIEW * 2, h: VIEW * 2, d: 320 };

  function layout() {
    const aspect = innerWidth / innerHeight;
    camera.left = -VIEW * aspect;
    camera.right = VIEW * aspect;
    camera.top = VIEW;
    camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
    field.w = VIEW * 2 * aspect;
    field.h = VIEW * 2;
    uField.value.set(field.w, field.h, field.d);
    renderer.setSize(innerWidth, innerHeight);
  }

  /* ------------------------------------------------------- plankton (GPU) */

  const positions = instancedArray(PLANKTON, 'vec3');
  const velocities = instancedArray(PLANKTON, 'vec3');

  const uLamp = uniform(new THREE.Vector3());
  const uField = uniform(new THREE.Vector3(field.w, field.h, field.d));
  const uReach = uniform(210);            // how far the lamp is felt
  const uPull = uniform(150);             // how hard it pulls

  // rim spawn: an angle from the particle's own hash, drifted by time so a
  // respawning particle never lands where it did last time
  const rimSpawn = Fn(() => {
    const a = hash(instanceIndex).mul(6.2831853).add(time.mul(1.7));
    const r = hash(instanceIndex.add(31)).mul(0.35).add(0.62);
    return vec3(
      cos(a).mul(uField.x.mul(0.5).mul(r)),
      sin(a).mul(uField.y.mul(0.5).mul(r)),
      hash(instanceIndex.add(97)).sub(0.5).mul(uField.z)
    );
  });

  const computeInit = Fn(() => {
    positions.element(instanceIndex).assign(vec3(
      hash(instanceIndex).sub(0.5).mul(uField.x),
      hash(instanceIndex.add(11)).sub(0.5).mul(uField.y),
      hash(instanceIndex.add(23)).sub(0.5).mul(uField.z)
    ));
    velocities.element(instanceIndex).assign(vec3(0));
  })().compute(PLANKTON);

  const computeUpdate = Fn(() => {
    const pos = positions.element(instanceIndex);
    const vel = velocities.element(instanceIndex);
    const dt = deltaTime.min(1 / 30);

    const toLamp = uLamp.sub(pos);
    const dist = toLamp.length().max(0.001);
    const dir = toLamp.div(dist);

    // ambient current — cheap, non-repeating, reads as water
    const acc = vec3(
      sin(pos.y.mul(0.011).add(time.mul(0.47))),
      cos(pos.x.mul(0.009).sub(time.mul(0.41))),
      sin(pos.z.mul(0.021).add(time.mul(0.33)))
    ).mul(26).toVar();

    If(dist.lessThan(uReach), () => {
      const pull = float(1).sub(dist.div(uReach));
      acc.addAssign(dir.mul(pull.mul(uPull)));
      // tangential term so they orbit the lure instead of collapsing onto it
      acc.addAssign(vec3(dir.y.negate(), dir.x, 0).mul(pull.mul(230)));
    });

    vel.assign(vel.add(acc.mul(dt)).mul(0.984));
    const speed = vel.length();
    If(speed.greaterThan(240), () => { vel.assign(vel.mul(float(240).div(speed))); });
    pos.addAssign(vel.mul(dt));

    // swallowed by the lure
    If(dist.lessThan(26), () => {
      pos.assign(rimSpawn());
      vel.assign(vec3(0));
    });

    // toroidal field — fract, not mod, so negatives wrap correctly
    const half = uField.mul(0.5);
    pos.assign(pos.add(half).div(uField).fract().mul(uField).sub(half));
  })().compute(PLANKTON);

  const plankton = new THREE.Sprite(new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  {
    const m = plankton.material;
    const speed = velocities.toAttribute().length();
    const falloff = float(1).sub(uv().sub(0.5).length().mul(2)).max(0).pow(2.6);
    m.positionNode = positions.toAttribute();
    m.scaleNode = vec2(7);
    m.colorNode = vec4(
      mix(vec3(0.09, 0.38, 0.78), vec3(0.52, 0.94, 1.0), speed.mul(0.007).clamp(0, 1)),
      falloff.mul(0.65)
    );
  }
  plankton.count = PLANKTON;
  plankton.frustumCulled = false;
  scene.add(plankton);

  /* ------------------------------------------------------- entities (CPU) */

  const glowMat = (hex, intensity = 1) => {
    const m = new THREE.MeshBasicNodeMaterial({ toneMapped: false });
    m.color = new THREE.Color(hex).multiplyScalar(intensity);
    return m;
  };

  const lure = new THREE.Mesh(new THREE.SphereGeometry(11, 24, 16), glowMat(0xffd27a, 2.2));
  scene.add(lure);

  const halo = new THREE.Sprite(new THREE.SpriteNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  halo.material.colorNode = vec4(
    vec3(1.0, 0.78, 0.42),
    float(1).sub(uv().sub(0.5).length().mul(2)).max(0).pow(3).mul(0.85)
  );
  halo.scale.setScalar(170);
  scene.add(halo);

  const PEARLS = 6;
  const pearlGeo = new THREE.SphereGeometry(9, 20, 14);
  const pearlMat = glowMat(0x6fe8ff, 2.6);
  const pearls = Array.from({ length: PEARLS }, () => {
    const m = new THREE.Mesh(pearlGeo, pearlMat);
    scene.add(m);
    return { mesh: m, drift: new THREE.Vector2() };
  });

  const hunterGeo = new THREE.IcosahedronGeometry(15, 0);
  const hunterMat = glowMat(0x8a6bff, 2.0);
  const hunters = [];

  function spawnHunter() {
    const m = new THREE.Mesh(hunterGeo, hunterMat);
    const a = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(a) * field.w * 0.55, Math.sin(a) * field.h * 0.55, 0);
    scene.add(m);
    hunters.push({ mesh: m, speed: 96 + Math.random() * 40, spin: Math.random() * 2 - 1 });
  }

  function placePearl(p) {
    p.mesh.position.set(
      (Math.random() - 0.5) * field.w * 0.86,
      (Math.random() - 0.5) * field.h * 0.86,
      0
    );
    p.drift.set((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40);
  }

  /* ------------------------------------------------------------ post stack */

  const post = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const colour = scenePass.getTextureNode();
  post.outputNode = colour.add(bloom(colour, 0.9, 0.5, 0.25));

  /* ------------------------------------------------------------ interaction */

  const target = new THREE.Vector2();
  const keys = new Set();
  let pointerDown = false;
  let usingKeys = false;

  function pointAt(e) {
    const r = renderer.domElement.getBoundingClientRect();
    target.x = ((e.clientX - r.left) / r.width * 2 - 1) * (VIEW * (innerWidth / innerHeight));
    target.y = -((e.clientY - r.top) / r.height * 2 - 1) * VIEW;
    usingKeys = false;
  }
  renderer.domElement.addEventListener('pointermove', pointAt);
  renderer.domElement.addEventListener('pointerdown', (e) => {
    renderer.domElement.setPointerCapture(e.pointerId);
    pointAt(e);
    pointerDown = true;
  });
  addEventListener('pointerup', () => { pointerDown = false; });
  addEventListener('keydown', (e) => {
    if (e.code === 'Space') e.preventDefault();
    keys.add(e.code);
    if (/^(Arrow|Key[WASD])/.test(e.code)) usingKeys = true;
    if (e.code === 'Enter' && state !== 'play') start();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); pointerDown = false; });
  addEventListener('resize', layout);

  /* ------------------------------------------------------------- game state */

  let state = 'attract';
  let score = 0, hull = 100, energy = 100, elapsed = 0, pulse = 0, nextHunter = 0, best = 0;

  function start() {
    score = 0; hull = 100; energy = 100; elapsed = 0; pulse = 0; nextHunter = 6;
    lure.position.set(0, 0, 0);
    target.set(0, 0);
    hunters.forEach((h) => scene.remove(h.mesh));
    hunters.length = 0;
    spawnHunter();
    pearls.forEach(placePearl);
    state = 'play';
    veil.hidden = true;
    hud.classList.remove('off');
  }
  el('startBtn').addEventListener('click', start);

  function gameOver() {
    state = 'over';
    best = Math.max(best, score);
    card.innerHTML =
      '<div class="eyebrow">the lamp goes dark</div><h2>Hull breached</h2>' +
      '<p class="lede">The hunters found you. The plankton scatter, and the current takes what is left.</p>' +
      '<div class="final">' +
        '<div><span class="eyebrow">pearls</span><b>' + fmt.format(score) + '</b></div>' +
        '<div><span class="eyebrow">survived</span><b>' + clock(elapsed) + '</b></div>' +
        '<div><span class="eyebrow">best</span><b>' + fmt.format(best) + '</b></div>' +
      '</div>' +
      '<button id="againBtn" type="button">Dive again</button>';
    el('againBtn').addEventListener('click', start);
    el('againBtn').focus();
    veil.hidden = false;
    hud.classList.add('off');
  }

  /* -------------------------------------------------------------- the loop */

  layout();
  renderer.compute(computeInit);
  pearls.forEach(placePearl);

  const tmp = new THREE.Vector3();
  let prev = performance.now();
  let fpsAcc = 0, fpsN = 0, hudAcc = 0;

  function frame(now) {
    const dt = Math.min((now - prev) / 1000, 1 / 20);
    prev = now;
    const playing = state === 'play';
    if (playing) elapsed += dt;

    // lamp
    const wantPulse = playing && (pointerDown || keys.has('Space')) && energy > 1;
    pulse += ((wantPulse ? 1 : 0) - pulse) * Math.min(1, dt * 9);
    energy = Math.max(0, Math.min(100, energy + (wantPulse ? -24 : 13) * dt));
    uReach.value = 200 + 300 * pulse;
    uPull.value = 150 + 620 * pulse;

    // steering
    if (playing) {
      if (usingKeys) {
        const sp = 560 * dt;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) target.x -= sp;
        if (keys.has('KeyD') || keys.has('ArrowRight')) target.x += sp;
        if (keys.has('KeyW') || keys.has('ArrowUp')) target.y += sp;
        if (keys.has('KeyS') || keys.has('ArrowDown')) target.y -= sp;
      }
      target.x = THREE.MathUtils.clamp(target.x, -field.w / 2, field.w / 2);
      target.y = THREE.MathUtils.clamp(target.y, -field.h / 2, field.h / 2);
    } else {
      target.set(
        Math.cos(now / 3400) * field.w * 0.3,
        Math.sin(now / 2600) * field.h * 0.28
      );
    }
    const ease = 1 - Math.pow(0.002, dt);
    lure.position.x += (target.x - lure.position.x) * ease;
    lure.position.y += (target.y - lure.position.y) * ease;
    lure.scale.setScalar(1 + 0.18 * pulse);
    halo.position.copy(lure.position);
    halo.scale.setScalar(150 + 220 * pulse);
    halo.material.opacity = 1;
    uLamp.value.copy(lure.position);

    // pearls: drift, and get reeled in while the lamp is pulsing
    for (const p of pearls) {
      p.mesh.position.x += p.drift.x * dt;
      p.mesh.position.y += p.drift.y * dt;
      if (Math.abs(p.mesh.position.x) > field.w / 2) p.drift.x *= -1;
      if (Math.abs(p.mesh.position.y) > field.h / 2) p.drift.y *= -1;
      p.mesh.rotation.y += dt * 1.4;

      if (!playing) continue;
      tmp.subVectors(lure.position, p.mesh.position);
      const d = tmp.length();
      if (pulse > 0.15 && d < 340) {
        tmp.normalize().multiplyScalar(pulse * 300 * dt * (1 - d / 340) * 2);
        p.mesh.position.add(tmp);
      }
      if (d < 30) {
        score++;
        energy = Math.min(100, energy + 6);
        placePearl(p);
      }
    }

    // hunters
    if (playing && elapsed > nextHunter && hunters.length < 12) {
      nextHunter += 10;
      spawnHunter();
    }
    for (const h of hunters) {
      const chase = playing ? 1 : 0.35;
      tmp.subVectors(lure.position, h.mesh.position);
      const d = Math.max(tmp.length(), 0.001);
      tmp.divideScalar(d).multiplyScalar(h.speed * (1 + 0.55 * pulse) * (1 + elapsed * 0.012) * chase * dt);
      h.mesh.position.add(tmp);
      h.mesh.rotation.x += dt * h.spin;
      h.mesh.rotation.z += dt * h.spin * 0.7;
      if (playing && d < 30) {
        hull -= 46 * dt;
        if (hull <= 0) { hull = 0; gameOver(); }
      }
    }

    // gpu sim + frame
    renderer.compute(computeUpdate);
    post.render();

    // hud
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; hudAcc += dt;
    if (hudAcc > 0.2) {
      el('fps').textContent = Math.round(fpsAcc / fpsN);
      el('scoreOut').textContent = fmt.format(score);
      el('timeOut').textContent = clock(elapsed);
      el('hunterCount').textContent = hunters.length;
      el('depth').textContent = fmt.format(4180 + Math.floor(elapsed * 7));
      el('energyPct').textContent = Math.round(energy);
      el('hullPct').textContent = Math.max(0, Math.round(hull));
      el('energyBar').style.width = energy + '%';
      el('hullBar').style.width = Math.max(0, hull) + '%';
      el('hullWrap').classList.toggle('critical', hull < 34);
      el('hint').textContent = pulse > 0.4 ? 'they can see you' : 'hold to pulse the lamp';
      fpsAcc = 0; fpsN = 0; hudAcc = 0;
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main().catch((e) => fail('Initialisation failed: <code>' + (e?.message ?? e) + '</code>'));
