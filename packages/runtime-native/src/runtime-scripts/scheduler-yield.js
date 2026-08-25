(() => {
  const scope = globalThis;
  const existing = scope.scheduler;
  if (existing !== undefined && typeof existing.yield === "function") return true;
  const scheduler = existing === undefined || existing === null ? {} : existing;
  // A macrotask is the honest implementation: the yield has to let the loop run, and one
  // setTimeout(0) is exactly one loop iteration here. A microtask would defeat the reason
  // three calls it.
  scheduler.yield = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  // Assigned through globalThis by name, not through the `scope` alias, so the shim manifest
  // gate can read the installation instead of taking the alias on trust.
  globalThis.scheduler = scheduler;
  return typeof scope.scheduler.yield === "function" &&
    typeof scope.self === "object" && scope.self.scheduler === scheduler;
})
