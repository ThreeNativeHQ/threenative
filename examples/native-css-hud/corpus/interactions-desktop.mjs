// The interaction corpus on the real desktop host: translate each scenario's script into a playtest
// over the grammar the runner really has, run it, and compare the observations with the list
// `corpus/interaction.mjs` produces in Chromium (`CHROMIUM_ONLY=1`).
//
// Three things the grammar cannot say, said out loud rather than approximated:
//   - a wheel step: the desktop runner has no wheel injector and refuses the step by name;
//   - `Shift+Tab`: the synthetic key reaches `tn_css_ui_key` as the literal string the scenario
//     pressed, and there is no modifier channel to pair with it, so every observation after one is
//     unreachable (the prefix before it is still compared);
//   - `env` and a touch pointer: neither `prefers-color-scheme`/`prefers-reduced-motion` nor a finger
//     can be injected, because both come from the host's own environment.
//
// Focus is the fourth thing the grammar cannot report: the engine records `focus` in its listener
// table but registers no DOM listener for it, so no `onFocus` ever reaches the game's JS realm and
// `tn_css_ui_focused_id` is host-side only. Focus is therefore read the only way the host can show it
// — as pixels: which candidate control's box changed against the untouched baseline frame is the one
// that has `:focus-visible`. That is a real measurement of what a player sees, and it is not the same
// claim as reading the engine's own focus counter.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { here } from "./shared.mjs";

/** Fixed-step ticks per input step: 30 ticks at the harness's 1/60 s step is 500 ms of real time. */
const SETTLE_TICKS = 30;
const KEY_HOLD_TICKS = 2;
/** Chromium's pixel tolerance, from `corpus/interaction.mjs`; an AA edge may need the wider one. */
export const PIXEL_TOLERANCE = 3;
export const PIXEL_TOLERANCE_AA = 8;
/** A focus ring has to repaint enough of its box to be a measurement rather than a guess. */
const FOCUS_MIN_PIXELS = 10;

/** The longest a transition in this stylesheet can take, so "settled" is the stylesheet's own number. */
export function settleMs(css) {
  let worst = 0;
  for (const match of css.matchAll(/transition(?:-[a-z-]+)?\s*:\s*([^;}]+)/gu)) {
    const ms = [...match[1].matchAll(/(\d+(?:\.\d+)?)ms/gu)].map((part) => Number(part[1]));
    worst = Math.max(
      worst,
      ms.reduce((sum, value) => sum + value, 0),
    );
  }
  return worst;
}

/** Blitz's own focusability: a non-disabled `<button>`, or anything with `tabindex` >= 0. */
export function focusCandidates(tree) {
  const candidates = [];
  const walk = (node) => {
    if (node.text !== undefined) return;
    const tabindex = node.attrs.tabindex;
    const focusable =
      node.tag === "button"
        ? node.attrs.disabled === undefined
        : tabindex !== undefined && Number(tabindex) >= 0;
    if (focusable) candidates.push(node.n);
    for (const child of node.children) walk(child);
  };
  for (const root of tree) walk(root);
  return candidates;
}

/**
 * The Chromium expected observations, from the interaction oracle itself.
 *
 * Shelled out to rather than reimplemented: that script's Chromium half is the definition of the
 * expectation, including the virtual clock and the media emulation, and this file must not hold a
 * second copy of it.
 */
export function chromiumExpected(names) {
  const result = spawnSync(process.execPath, [join(here, "interaction.mjs"), ...names], {
    cwd: here,
    encoding: "utf8",
    // biome-ignore lint/style/useNamingConvention: CHROMIUM_ONLY is the environment variable's own name.
    env: { ...process.env, CHROMIUM_ONLY: "1" },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0)
    throw new Error(`TN_DESKTOP_INTERACTION_ORACLE_FAILED: ${output.slice(-600)}`);
  const expected = new Map();
  for (const line of output.split("\n")) {
    const at = line.indexOf(" [");
    if (at < 0) continue;
    expected.set(line.slice(0, at), JSON.parse(line.slice(at + 1)));
  }
  for (const name of names)
    if (!expected.has(name))
      throw new Error(
        `TN_DESKTOP_INTERACTION_ORACLE_SILENT: ${name} produced no expected observations`,
      );
  return expected;
}

/**
 * The element boxes of the scenario page the oracle already built, and how long each sample point's
 * own transition takes.
 *
 * `CHROMIUM_ONLY=1 corpus/interaction.mjs` leaves the exact page it ran in `out-interaction/<name>/`,
 * so the focus decoder reads its geometry from that file with the same launch flags rather than
 * rebuilding the scenario's fixtures, sheet or hinting here. The settle time is the element actually
 * under the sample point, because that is the only element whose transition the expected pixel is
 * showing: the sheet's longest transition is not the one that matters at (50, 80).
 */
export async function scenarioBoxes(browser, scenario, samplePoints = []) {
  const page = join(here, "out-interaction", scenario.name, "page.html");
  if (!existsSync(page))
    throw new Error(
      `TN_DESKTOP_INTERACTION_PAGE_MISSING: ${page} (run corpus/interaction.mjs first)`,
    );
  const [width, height] = scenario.size;
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    ...(scenario.touch ? { hasTouch: true, isMobile: true } : {}),
  });
  const handle = await context.newPage();
  await handle.goto(`file://${page}`);
  await handle.evaluate(async () => {
    await document.fonts.ready;
  });
  const boxes = await handle.evaluate(() =>
    [...document.querySelectorAll("[data-n]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { n: Number(el.dataset.n), x: r.x, y: r.y, w: r.width, h: r.height };
    }),
  );
  const samples = await handle.evaluate((points) => {
    const longest = (list) =>
      list
        .map((value) => Number.parseFloat(value))
        .filter((value) => Number.isFinite(value))
        .reduce((worst, value) => Math.max(worst, value * 1000), 0);
    return points.map((point) => {
      const element = document.elementFromPoint(point.x, point.y);
      if (element === null) return { ...point, settleMs: 0, under: null };
      const style = getComputedStyle(element);
      return {
        ...point,
        settleMs:
          longest(style.transitionDuration.split(",")) + longest(style.transitionDelay.split(",")),
        under: `${element.tagName.toLowerCase()}.${element.className}`,
      };
    });
  }, samplePoints);
  await context.close();
  return { boxes, samples };
}

/**
 * Translate one script into playtest steps plus the observation list that goes with them.
 *
 * The observation list is positional with the oracle's: entry `i` here is entry `i` of the expected
 * list, in the order the script observes. An entry the host cannot be asked for carries the reason
 * and is left out of the comparison, and everything after the first unreachable step carries the same
 * reason. `samples` is the per-pixel settle time measured in Chromium (see `scenarioBoxes`).
 */
export function translate(scenario, expected, { screenshots = true, samples = [] } = {}) {
  const [width, height] = scenario.size;
  const shot = (label) => (screenshots ? { screenshot: label } : {});
  const steps = [{ label: "baseline", waitTicks: 60, ...shot("baseline") }];
  const observations = [];
  let sinceInput = 0;
  let unreachable;
  let observed = 0;
  const at = (x, y, buttons) => ({ id: 1, x: x / width, y: y / height, buttons });
  const record = (obs, extra = {}) => {
    observations.push({
      index: observed,
      obs,
      ...(unreachable === undefined ? {} : { why: unreachable }),
      ...extra,
    });
    observed += 1;
  };
  for (const step of scenario.script) {
    if (unreachable !== undefined) {
      if (step.obs !== undefined) record("unreachable");
      continue;
    }
    if (step.obs !== undefined) {
      const label = `obs-${observed}`;
      if (step.obs === "scroll") {
        record("scroll", {
          why: "a wheel step: the desktop runner has no wheel injector, so nothing reached this point",
        });
        unreachable = "a wheel step: the desktop runner has no wheel injector";
        continue;
      }
      // A pixel observation is comparable only where the element under it has finished its
      // transition: the host's clock is real, so a mid-transition moment cannot be reproduced, and
      // comparing a settled host frame against a half-way expected pixel would be a false failure.
      const settle =
        step.obs === "pixel" ? (samples[observed]?.settleMs ?? settleMs(scenario.css)) : 0;
      const settled = sinceInput >= settle;
      // A pixel or focus observation is read off a capture at that exact step, so it carries one. A
      // click observation is read out of the game's own state, so it does not: the run keeps a single
      // visual frame at the end instead, which is where a low-colour scenario would otherwise be
      // refused by the runner's blank-capture guard before any observation was taken.
      steps.push({
        label,
        waitTicks: 1,
        ...(step.obs === "pixel" || step.obs === "focus" ? shot(label) : {}),
      });
      record(step.obs, {
        label,
        ...(settled
          ? {}
          : { why: `mid-transition: ${sinceInput}ms elapsed of the ${settle}ms this sheet takes` }),
        ...(step.obs === "pixel" ? { at: [step.x, step.y] } : {}),
      });
      continue;
    }
    if (step.t === "key") {
      if (step.shift === true) {
        unreachable =
          "Shift+Tab: the synthetic key reaches the UI as the literal string pressed, with no modifier channel";
        continue;
      }
      steps.push({ press: step.key, holdTicks: KEY_HOLD_TICKS, release: true });
      steps.push({ waitTicks: SETTLE_TICKS });
      sinceInput = 0;
      continue;
    }
    if (step.t === "pointer") {
      if (step.pointerType === "touch") {
        unreachable =
          "a finger: the host decides the pointer kind and the runner injects no touch pointer";
        continue;
      }
      // A move is a `pointerPosition` with no buttons: the runner's `input.pointers` request rejects a
      // zero-button pointer and defaults an absent one to a press, so hover has exactly one channel
      // and this is it. A press is the held set with one button, and a release is the empty set.
      steps.push(
        step.type === "up"
          ? { pointers: [], release: true }
          : step.type === "down"
            ? { pointers: [at(step.x, step.y, 1)], release: false }
            : { pointerPosition: { x: step.x / width, y: step.y / height }, release: false },
      );
      steps.push({ waitTicks: SETTLE_TICKS });
      sinceInput = 0;
      continue;
    }
    if (step.t === "wheel") {
      unreachable = "a wheel step: the desktop runner has no wheel injector";
      continue;
    }
    if (step.t === "advance") {
      sinceInput += step.ms;
      continue;
    }
    // Anything else in the grammar is an environment the host reports for itself.
    unreachable =
      "prefers-color-scheme/reduced-motion: the host reports its own environment and the runner injects neither";
  }
  if (observed !== expected.length)
    throw new Error(
      `TN_DESKTOP_INTERACTION_OBSERVATION_COUNT: translated ${observed} observations, the oracle expected ${expected.length}`,
    );
  steps.push({ label: "final", waitTicks: 1, ...shot("final") });
  return { steps, observations };
}

/**
 * The playtest for one translated scenario.
 *
 * The click ledger is asserted here, so a host whose clicks diverge from Chromium's fails the run
 * itself rather than a comparison this driver has to remember to make.
 */
export function scenarioJson(scenario, translated, expected) {
  const clicks = translated.observations
    .filter((entry) => entry.obs === "clicks" && entry.why === undefined)
    // The oracle's click list is cumulative, so the ledger at this observation is exactly it.
    .map((entry) => ({ label: entry.label, equals: expected[entry.index].join(",") }));
  const labels = translated.steps.filter((step) => step.label !== undefined);
  return {
    schemaVersion: 1,
    name: `corpus-${scenario.name}`,
    target: "desktop",
    viewport: { width: scenario.size[0], height: scenario.size[1] },
    warmupFrames: 0,
    steps: translated.steps,
    // The runner's own before/after frames go through the same blank-capture guard a scenario's
    // screenshots do, so a run that exists to observe state rather than pixels asks for neither.
    artifacts: {
      console: true,
      screenshots: translated.steps.some((step) => step.screenshot !== undefined),
    },
    assert: {
      resources: [
        { id: "GameState", path: "frames", changed: true, gte: 100 },
        {
          id: "GameState",
          path: "mounted",
          atSteps: [{ label: labels.at(-1).label, equals: true }],
        },
        ...(clicks.length === 0 ? [] : [{ id: "GameState", path: "clicks", atSteps: clicks }]),
      ],
    },
  };
}

/** One pixel of a capture, as the viewer sees it (the capture is opaque, so no compositing here). */
export function pixelAt(image, x, y) {
  const index = (image.width * Math.round(y) + Math.round(x)) << 2;
  return [image.data[index], image.data[index + 1], image.data[index + 2]];
}

const near = (a, b, tolerance) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

/**
 * Which control has focus, read off the capture.
 *
 * The candidate whose box changed against the untouched baseline is the one whose `:focus-visible`
 * rule is painting. Nothing changed means focus is outside the document, which is how the oracle
 * reports `0` too. Two candidates within half of each other are left undecided rather than picking a
 * winner.
 */
export function focusedFrom(base, capture, boxes, candidates) {
  const changed = candidates.map((n) => {
    const box = boxes.find((entry) => entry.n === n);
    if (box === undefined) return { n, pixels: 0 };
    let pixels = 0;
    for (let y = Math.max(0, Math.round(box.y)); y < Math.min(capture.height, box.y + box.h); y++) {
      for (
        let x = Math.max(0, Math.round(box.x));
        x < Math.min(capture.width, box.x + box.w);
        x++
      ) {
        if (!near(pixelAt(base, x, y), pixelAt(capture, x, y), 8)) pixels += 1;
      }
    }
    return { n, pixels };
  });
  const ranked = [...changed].sort((a, b) => b.pixels - a.pixels);
  const top = ranked[0]?.pixels ?? 0;
  if (top < FOCUS_MIN_PIXELS) return { focused: 0, changed };
  if ((ranked[1]?.pixels ?? 0) * 2 > top)
    return {
      focused: null,
      why: `ambiguous between the top two candidates: ${JSON.stringify(ranked.slice(0, 2))}`,
    };
  return { focused: ranked[0].n, changed };
}

/** Read a per-step value out of the resource series the runner recorded, rather than assuming it. */
export function resourceAt(runnerReport, label, path) {
  const series = runnerReport?.observations?.resourceSeries ?? [];
  return series.find((item) => item.label === label)?.snapshots?.GameState?.[path];
}
