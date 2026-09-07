((enqueue) => {
  const scope = globalThis;
  const existing = scope.scheduler;
  if (existing !== undefined && typeof existing.yield === "function") return true;
  const scheduler = existing === undefined || existing === null ? {} : existing;
  // The host drains cooperative tasks with a bounded time slice between frames. Its timer
  // queue is frame-coupled; using setTimeout here makes each shader node pay for a frame.
  scheduler.yield = () => new Promise((resolve) => { enqueue(resolve); });
  // Assigned through globalThis by name, not through the `scope` alias, so the shim manifest
  // gate can read the installation instead of taking the alias on trust.
  globalThis.scheduler = scheduler;
  return typeof scope.scheduler.yield === "function" &&
    typeof scope.self === "object" && scope.self.scheduler === scheduler;
})
