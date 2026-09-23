/**
 * What one V8-to-host call costs, on this machine, in nanoseconds.
 *
 * One of the three hypotheses about the reference game's unattributed render time is that the
 * boundary dominates it: 10.9 ms over 573 draws is 19.0 microseconds per draw, which at a
 * plausible crossing price would need about ten crossings per draw. Either the price is enormous
 * or the cost is not per-draw at all, and nobody had measured the price. This measures it.
 *
 * **It is priced down, not up, and the method matters.** The call under test is the cheapest
 * binding the host has — `__tnPresentedCount()` returns a counter the host already keeps and does
 * no work of its own — so what is left is the crossing: argument marshalling, the native entry,
 * and the return. A heavier binding would measure the binding. The loop is compared against an
 * identical loop over a pure-JS function so the loop's own overhead is subtracted rather than
 * attributed to the boundary, and the result is a median over repeats, because the first repeat
 * is the one that pays for the inline cache.
 *
 * Run: `mystral run packages/runtime-native/scripts/bench-host-boundary.js --headless`
 */

const ITERATIONS = 1_000_000;
const REPEATS = 7;

/** A pure-JS control with the same call shape, so the loop's own cost is measured, not guessed. */
let controlCounter = 0;
function controlCall() {
  controlCounter += 1;
  return controlCounter;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function time(call) {
  const started = performance.now();
  let sink = 0;
  for (let index = 0; index < ITERATIONS; index += 1) sink += call();
  const elapsed = performance.now() - started;
  // Returned so the loop cannot be optimised away as dead.
  return { elapsed, sink };
}

function main() {
  const host = globalThis;
  if (typeof host.__tnPresentedCount !== "function") {
    // Fail closed: a host without the seam cannot be measured, and reporting zero would be a
    // number somebody would quote.
    console.log(
      'TN_HOST_BOUNDARY:{"error":"__tnPresentedCount is not installed, so no crossing was measured"}',
    );
    return;
  }
  const bridge = host.__tnPresentedCount;

  const bridgeMs = [];
  const controlMs = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    // Alternate, so a drift in the machine cannot land on one arm.
    bridgeMs.push(time(bridge).elapsed);
    controlMs.push(time(controlCall).elapsed);
  }

  const bridgeMedian = median(bridgeMs);
  const controlMedian = median(controlMs);
  const perCallNs = ((bridgeMedian - controlMedian) * 1e6) / ITERATIONS;
  const totalNs = (bridgeMedian * 1e6) / ITERATIONS;
  console.log(
    `TN_HOST_BOUNDARY:${JSON.stringify({
      bridgeMedianMs: Math.round(bridgeMedian * 1000) / 1000,
      controlMedianMs: Math.round(controlMedian * 1000) / 1000,
      crossingNs: Math.round(perCallNs * 1000) / 1000,
      iterations: ITERATIONS,
      repeats: REPEATS,
      withLoopNs: Math.round(totalNs * 1000) / 1000,
    })}`,
  );
}

main();
