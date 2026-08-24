// Phase 0 probe: does React + react-reconciler load, mount and update under a native JS engine,
// and what does one state change cost? Host nodes are plain objects so this measures React, not
// Three.js.
import { createElement as h, useState } from "react";
import { createRootContainer, reconciler, stats } from "./host.js";

const now =
  typeof performance !== "undefined" && performance.now
    ? () => performance.now()
    : () => Date.now();

function Row({ label, value }) {
  return h("box", { x: 0, y: 0, w: 120, h: 16 }, h("text", { value: `${label} ${value}` }));
}

function scenario(rowCount) {
  let setScore = null;
  function Hud() {
    const [score, setter] = useState(0);
    setScore = setter;
    const rows = [];
    for (let i = 0; i < rowCount; i += 1) {
      // Only the first row depends on the changing value: a real HUD changes one readout at a
      // time, and the point of the measurement is what React does with the rows that did not.
      rows.push(h(Row, { key: i, label: `STAT${i}`, value: i === 0 ? score : i }));
    }
    return h("box", { anchor: "topLeft", x: 16, y: 16, w: 240, h: 16 * rowCount }, ...rows);
  }

  const { container, root } = createRootContainer();
  const before = { ...stats };
  const mountStart = now();
  reconciler.updateContainerSync(h(Hud), root, null, null);
  reconciler.flushSyncWork();
  const mountMs = now() - mountStart;
  const mountedNodes = stats.creates - before.creates;

  const iterations = Number(globalThis.TN_PROBE_ITERATIONS ?? 500);
  const warm = 50;
  const afterMount = { ...stats };
  const samples = [];
  for (let i = 1; i <= iterations + warm; i += 1) {
    const start = now();
    reconciler.flushSyncFromReconciler(() => {
      setScore(i);
    });
    reconciler.flushSyncWork();
    const elapsed = now() - start;
    if (i > warm) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))];
  const perChange = (key) => (stats[key] - afterMount[key]) / (iterations + warm);

  return {
    container,
    mountMs,
    mountedNodes,
    p50: pick(0.5),
    p95: pick(0.95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    creates: perChange("creates"),
    updates: perChange("updates"),
    appends: perChange("appends"),
    removes: perChange("removes"),
  };
}

function render(node, depth = 0) {
  const pad = "  ".repeat(depth);
  const label = node.type === "#text" ? `#text ${JSON.stringify(node.text)}` : node.type;
  const props = node.props ? ` ${JSON.stringify(node.props)}` : "";
  const lines = [`${pad}${label}${props}`];
  for (const child of node.children) lines.push(render(child, depth + 1));
  return lines.join("\n");
}

const small = scenario(3);
console.log("--- mounted tree, 3 rows ---");
console.log(render(small.container));

for (const [rows, r] of [
  [3, small],
  [24, scenario(24)],
]) {
  console.log(
    `rows=${rows} nodes=${r.mountedNodes} mount=${r.mountMs.toFixed(3)}ms ` +
      `change p50=${r.p50.toFixed(4)}ms p95=${r.p95.toFixed(4)}ms mean=${r.mean.toFixed(4)}ms ` +
      `hostOps/change create=${r.creates} update=${r.updates} append=${r.appends} remove=${r.removes}`,
  );
}

// A frame with no state change must cost nothing: React is not asked to do anything, so the
// game loop calling into it every frame is free.
const idleStart = now();
for (let i = 0; i < 100_000; i += 1) reconciler.flushSyncWork();
console.log(`100000 idle flushes: ${(now() - idleStart).toFixed(3)} ms total`);
console.log("TN_PROBE_OK");
