// Minimal host globals the ThreeNative native runtime already installs (runtime.cpp registers
// console, performance, setTimeout, setInterval, requestAnimationFrame). qjs standalone has none
// of them, so the probe supplies the same shapes and nothing more.
(function () {
  var timers = [];
  var id = 1;
  globalThis.setTimeout = function (fn, ms) {
    timers.push({ id: id, fn: fn, at: ms || 0 });
    return id++;
  };
  globalThis.clearTimeout = function (handle) {
    timers = timers.filter(function (t) {
      return t.id !== handle;
    });
  };
  globalThis.__drainTimers = function () {
    var pending = timers;
    timers = [];
    for (var i = 0; i < pending.length; i++) pending[i].fn();
    return pending.length;
  };
  if (typeof performance === "undefined") {
    var origin = Date.now();
    globalThis.performance = {
      now: function () {
        return Date.now() - origin;
      },
    };
  }
})();
