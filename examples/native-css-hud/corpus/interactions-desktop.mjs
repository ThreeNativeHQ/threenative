// The interaction corpus on the real desktop host: translate each scenario's script into a playtest
// over the grammar the runner really has, run it, and compare the observations with the list
// `corpus/interaction.mjs` produces in Chromium (`CHROMIUM_ONLY=1`).
//
// Time is the host's fixed UI clock (`TN_CSS_UI_FIXED_STEP_MS`, one millisecond per tick here), so
// Chromium's virtual `advance` becomes a tick count: every runner step costs the ticks it advances,
// and the translation waits out exactly the rest so a mid-transition pixel lands on Chromium's
// moment. Keys carry modifiers as a held set (`["Shift","Tab"]`), a mouse is `pointerPosition`, a
// finger is `pointers`, a wheel is `wheel` at its point, and `env` is a step's `media`.
//
// One thing the grammar still cannot say, said out loud rather than approximated: a scroll offset.
// The host has no channel that reports one, so a `scroll` observation is a named failure.
//
// Focus is the other thing the grammar cannot report: the engine records `focus` in its listener
// table but registers no DOM listener for it, so no `onFocus` ever reaches the game's JS realm and
// `tn_css_ui_focused_id` is host-side only. Focus is therefore read the only way the host can show it
// — as pixels: which candidate control's box changed against the untouched baseline frame is the one
// that has `:focus-visible`. That is a real measurement of what a player sees, and it is not the same
// claim as reading the engine's own focus counter.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { here } from "./shared.mjs";

/**
 * Milliseconds of UI clock per tick: the host's `TN_CSS_UI_FIXED_STEP_MS` for these runs. A tenth of
 * a millisecond, so the ticks an input or a capture costs where Chromium spends none skew a capture
 * by tenths of a millisecond rather than by whole ones.
 */
export const CLOCK_STEP_MS = 0.1;
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

/** The shortest transition duration in this stylesheet, or 0 when it has none. */
export function fastestMs(css) {
  const all = [...css.matchAll(/transition(?:-[a-z-]+)?\s*:\s*([^;}]+)/gu)].flatMap((match) =>
    [...match[1].matchAll(/(\d+(?:\.\d+)?)ms/gu)].slice(0, 1).map((part) => Number(part[1])),
  );
  return all.length === 0 ? 0 : Math.min(...all);
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
 * list, in the order the script observes. An entry the host cannot be asked for carries the reason,
 * and the driver counts it as a failure, never as a pass.
 *
 * The clock: Chromium spends no time on an input or an observation, and the runner spends ticks on
 * both (an input step advances at least one, a key or a tap two, a capture one unless it rides a
 * wait). The transition an input starts begins at the clock the input arrived on, so before every
 * input and capture the translation waits until the host's time since the last input equals
 * Chromium's. What it cannot take back is the few ticks an input or a capture costs where Chromium
 * spent none: that is the capture's `clockSkewMs` against every input whose transitions may still be
 * running, and a skew that could move a channel of the sheet's fastest transition by more than one
 * level is a named failure rather than a comparison.
 */
export function translate(scenario, expected, { screenshots = true } = {}) {
  const [width, height] = scenario.size;
  const settle = settleMs(scenario.css);
  const fastest = fastestMs(scenario.css);
  const shot = (label) => (screenshots ? { screenshot: label } : {});
  const ticksOf = (ms) => Math.round(ms / CLOCK_STEP_MS);
  // The oracle's page opens in Chromium's default environment, light and with no motion preference,
  // while the host reads its colour scheme from the OS; the run states the oracle's environment
  // rather than inheriting whatever the machine it runs on says.
  const steps = [
    {
      label: "baseline",
      media: { colorScheme: "light", reducedMotion: "no-preference" },
      waitTicks: 60,
      ...shot("baseline"),
    },
  ];
  const observations = [];
  let observed = 0;
  // Both clocks in ticks: Chromium's virtual time, the host's fixed clock, and every input on both.
  let chromium = 0;
  let host = 60;
  const inputs = [];
  let lastCapture;
  let unreachable;
  // Whether the last input that can move focus was a pointer press rather than a key.
  let pointerFocus = false;
  const behind = () => {
    const last = inputs.at(-1);
    return last === undefined ? 0 : chromium - last.chromium - (host - last.host);
  };
  const record = (obs, extra = {}) => {
    observations.push({ index: observed, obs, ...extra });
    observed += 1;
  };
  const push = (step, cost) => {
    steps.push(step);
    host += cost;
    lastCapture = undefined;
  };
  const input = (step, cost) => {
    const wait = behind();
    if (wait > 0) push({ waitTicks: wait }, wait);
    inputs.push({ chromium, host });
    push(step, cost);
  };
  /** The worst clock disagreement at a capture, against inputs whose transitions may still run. */
  const skewMs = () =>
    inputs
      .filter((at) => (chromium - at.chromium) * CLOCK_STEP_MS < settle)
      .reduce(
        (worst, at) =>
          Math.max(worst, Math.abs(host - at.host - (chromium - at.chromium)) * CLOCK_STEP_MS),
        0,
      );
  for (const step of scenario.script) {
    if (step.obs !== undefined) {
      if (step.obs === "scroll") {
        record("scroll", {
          why: "a scroll offset: the host exposes no channel that reports one (the CSS UI's C ABI has no scroll-offset entry point)",
        });
        continue;
      }
      if (unreachable !== undefined) {
        record(step.obs, { why: unreachable });
        continue;
      }
      if (step.obs === "focus" && pointerFocus) {
        record("focus", {
          why: "focus a click gave: `:focus-visible` does not match it, so no pixel shows it, and the host reports focus to no channel the run reads",
        });
        continue;
      }
      const pixels = step.obs === "pixel" || step.obs === "focus";
      const at = step.obs === "pixel" ? { at: [step.x, step.y] } : {};
      // A capture already taken at this instant serves every observation made at it.
      if (pixels && lastCapture !== undefined) {
        record(step.obs, { label: lastCapture.label, clockSkewMs: lastCapture.skew, ...at });
        continue;
      }
      const label = `obs-${observed}`;
      // A pixel or focus observation is read off a capture at that exact step, so it carries one. A
      // click observation is read out of the game's own state, so it does not.
      const waitTicks = Math.max(1, behind());
      push({ label, waitTicks, ...(pixels ? shot(label) : {}) }, waitTicks);
      const skew = Number(skewMs().toFixed(3));
      const levels = fastest === 0 ? 0 : (255 * skew) / fastest;
      if (pixels && screenshots) lastCapture = { label, skew };
      record(step.obs, {
        label,
        clockSkewMs: skew,
        ...(pixels && levels > 1
          ? {
              why: `mid-transition: the capture is ${skew}ms off Chromium's moment, up to ${levels.toFixed(1)} levels of the sheet's ${fastest}ms transition`,
            }
          : {}),
        ...at,
      });
      continue;
    }
    if (step.t === "advance") {
      chromium += ticksOf(step.ms);
      lastCapture = undefined;
      continue;
    }
    if (unreachable !== undefined) continue;
    const point = { x: step.x / width, y: step.y / height };
    if (step.t === "key") {
      const press = step.shift === true ? ["Shift", step.key] : step.key;
      pointerFocus = false;
      // One tick held, then the release's own tick.
      input({ press, holdTicks: 1, release: true }, 2);
    } else if (step.t === "pointer" && step.pointerType === "touch") {
      if (step.type === "down") pointerFocus = true;
      // Chromium's tap is down and up in one gesture on the `down` step; the `up` step is that tap's.
      if (step.type === "down") input({ pointers: [{ id: 1, ...point }], release: true }, 2);
      else if (step.type !== "up")
        unreachable = `a touch ${step.type}: Chromium's oracle only taps`;
    } else if (step.t === "pointer") {
      if (step.type === "move") input({ pointerPosition: point, release: false }, 1);
      else if (step.type === "down") {
        pointerFocus = true;
        input({ pointerPosition: { ...point, buttons: 1 }, release: false }, 1);
      } else if (step.type === "up") input({ pointerPosition: point, release: true }, 1);
      else unreachable = `a pointer ${step.type}: the runner has no step for it`;
    } else if (step.t === "wheel") {
      input({ wheel: { deltaX: step.dx ?? 0, deltaY: step.dy, ...point } }, 1);
    } else if (step.t === "env") {
      const media = {
        ...(step.dark === undefined ? {} : { colorScheme: step.dark ? "dark" : "light" }),
        ...(step.reducedMotion === undefined
          ? {}
          : { reducedMotion: step.reducedMotion ? "reduce" : "no-preference" }),
      };
      input({ media }, 1);
    } else unreachable = `a ${JSON.stringify(step)} step: the translation has no mapping for it`;
  }
  if (observed !== expected.length)
    throw new Error(
      `TN_DESKTOP_INTERACTION_OBSERVATION_COUNT: translated ${observed} observations, the oracle expected ${expected.length}`,
    );
  steps.push({ label: "final", waitTicks: 1, ...shot("final") });
  return { steps, observations };
}

/**
 * The same script cut at one capture, with that capture the only screenshot in it.
 *
 * The runner refuses a capture with fewer than eight distinct colours and stops the run there, and a
 * flat scenario has fewer by construction. The PNG is written before the guard reads it, so a run
 * whose last step is the capture keeps it, and the fixed clock makes the cut run reach the same frame.
 */
export function prefixFor(translated, label) {
  const end = translated.steps.findIndex((step) => step.label === label);
  if (end < 0) throw new Error(`TN_DESKTOP_INTERACTION_PREFIX: no step labelled ${label}`);
  const steps = translated.steps.slice(0, end + 1).map((step) => {
    if (step.screenshot === undefined || step.label === label) return step;
    const { screenshot: _dropped, ...rest } = step;
    return rest;
  });
  return { ...translated, steps };
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
