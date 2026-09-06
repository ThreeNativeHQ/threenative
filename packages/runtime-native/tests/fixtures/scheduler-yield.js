// Runs in the real host, not Node's differently scheduled timer loop.
let frames = 0;
let timerTicks = 0;
function frame() {
  frames += 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
setInterval(() => { timerTicks += 1; }, 1);
function require(value, message) {
  if (!value) throw new Error(message);
}
(async () => {
  const order = [];
  const yielded = self.scheduler.yield().then(() => order.push('task'));
  await Promise.resolve().then(() => order.push('microtask'));
  await yielded;
  require(order.join(',') === 'microtask,task', 'yield must run after the microtask checkpoint');
  const initialFrames = frames;
  for (let index = 0; index < 120; index += 1) await self.scheduler.yield();
  const crossedFrames = frames - initialFrames;
  require(crossedFrames < 60, `120 empty yields crossed ${crossedFrames} frames; still frame-coupled`);

  const busyFrames = frames;
  const busyTimers = timerTicks;
  for (let index = 0; index < 200; index += 1) {
    await self.scheduler.yield();
    const until = performance.now() + 0.25;
    while (performance.now() < until) { /* Controlled 50 ms workload in total. */ }
  }
  require(frames > busyFrames, 'cooperative work starved animation frames');
  require(timerTicks > busyTimers, 'cooperative work starved timers');
  console.log(`TN_SCHEDULER_CONTRACT:${JSON.stringify({ crossedFrames, busyFrames: frames - busyFrames, timerTicks: timerTicks - busyTimers })}`);
  process.exit(0);
})().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
