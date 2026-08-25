// Minimal host globals the ThreeNative native runtime already installs (runtime.cpp registers
// console, performance, setTimeout, setInterval, requestAnimationFrame). qjs standalone has none
// of them, so the probe supplies the same shapes and nothing more.
(() => {
  let timers = [];
  let id = 1;
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ id, fn, at: ms || 0 });
    return id++;
  };
  globalThis.clearTimeout = (handle) => {
    timers = timers.filter((timer) => timer.id !== handle);
  };
  globalThis.__drainTimers = () => {
    const pending = timers;
    timers = [];
    for (const timer of pending) timer.fn();
    return pending.length;
  };
  if (typeof performance === "undefined") {
    const origin = Date.now();
    globalThis.performance = {
      now: () => Date.now() - origin,
    };
  }
})();
