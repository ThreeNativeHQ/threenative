// Browser-service compatibility for core's existing seams; time advances on native fixed ticks.
let time = 0;
let nextId = 0;
const frames = new Map();
const timers = new Map();
const listeners = new Map();
const held = new Set();
const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

export const canvas = {
  width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, parentElement: null,
  addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
  },
  removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
};
globalThis.performance = { now: () => time };
globalThis.console = Object.fromEntries(["log", "info", "warn", "error"].map((name) => [name, (...args) => globalThis.tn.log(...args)]));
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++nextId, callback);
  return nextId;
};
globalThis.cancelAnimationFrame = (id) => frames.delete(id);
globalThis.setTimeout = (callback, delay = 0) => {
  timers.set(++nextId, { callback, due: time + delay });
  return nextId;
};
globalThis.clearTimeout = (id) => timers.delete(id);
globalThis.setInterval = (callback, delay) => {
  if (!Number.isFinite(delay) || delay <= 0) throw new Error("TN_CORE_TIMER: interval must be positive");
  timers.set(++nextId, { callback, due: time + delay, interval: delay });
  return nextId;
};
globalThis.clearInterval = globalThis.clearTimeout;

globalThis.tn.onUpdate((dt) => {
  time += dt * 1000;
  for (const key of keys) {
    const down = globalThis.tn.input.isDown(key);
    if (down === held.has(key)) continue;
    if (down) held.add(key); else held.delete(key);
    for (const callback of listeners.get(down ? "keydown" : "keyup") ?? []) callback({ code: key });
  }
  for (const [id, timer] of timers) {
    if (timer.due > time) continue;
    if (timer.interval === undefined) timers.delete(id);
    else timer.due += timer.interval;
    timer.callback();
  }
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(time);
});

const readSize = () => ({ width: canvas.width, height: canvas.height, aspect: canvas.width / canvas.height });
export const platform = {
  input: () => [],
  inputTarget: canvas,
  renderer: { createCanvas: () => canvas, hasWebGPU: () => true, readSize: () => [1280, 720], observeResize: () => () => {} },
  viewport: { readSize, observeResize: () => () => {} },
  mountCanvas() {},
  unmountCanvas() {},
};
