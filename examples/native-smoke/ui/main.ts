import {
  connectUiBridge,
  publishHitRegions,
  sendUiIntent,
  subscribeUiState,
} from "@threenative/core/ui-layer";

/**
 * The UI layer for the native-smoke example — the page the platform's web view loads.
 *
 * It is deliberately plain DOM rather than React: this is the Phase 0 input proof, and what it
 * has to exercise is the framework's registry and bridge, not a game's component tree. Every
 * line that decides ownership or moves a message comes from `@threenative/core/ui-layer`; the
 * only thing this file owns is which elements are interactive and what they send.
 */
interface ISmokeUiState {
  readonly pointerDowns?: number;
  readonly slide?: boolean;
}

const bridge = connectUiBridge({ end: "ui" });
const mirror = subscribeUiState<ISmokeUiState>(bridge);
const registry = publishHitRegions({ bridge });

const downs = document.getElementById("downs");
mirror.subscribe(() => {
  const state = mirror.get();
  if (downs !== null) downs.textContent = String(state?.pointerDowns ?? 0);
  // The game owns `slide`; the page only reacts to it. A UI that toggled its own transition
  // would prove the transition works and nothing about the bridge.
  document.body.classList.toggle("sliding", state?.slide === true);
});

document.getElementById("tap")?.addEventListener("click", () => {
  sendUiIntent(bridge, "slide");
});
const slider = document.getElementById("slider");
slider?.addEventListener("click", () => {
  sendUiIntent(bridge, "restart");
});
// Reported so a scenario can tell "the touch landed while the island was moving" from "the
// island had already settled". Without it, a probe at the island's old position passes for the
// wrong reason once the transition ends, which is a green that proves nothing.
slider?.addEventListener("transitionend", () => {
  sendUiIntent(bridge, "slideDone");
});

// The page-local clock. Nothing here reads the bridge and nothing posts to it: this is the page
// changing on its own, which is the case PRD-398 AC-2 asks about and the case the host's snapshot
// loop has to find without a game post. It runs in 10 s bursts with a 1 s idle between them, so one
// process exercises both the active capture and the resume from the idle backoff.
//
// Off unless `window.__tnPageAnimation` is set, because the UI-frame gate's page is meant to be
// static: turning this on there would move its ui-phase budget from the composite to the page's own
// paint and quietly change what that gate asserts.
const tick = document.getElementById("tick");
const ACTIVE_MS = 10000;
const IDLE_MS = 1000;
let ticks = 0;
let idle = false;
const animate = (now: number): void => {
  const phase = now % (ACTIVE_MS + IDLE_MS);
  const shouldIdle = phase >= ACTIVE_MS;
  if (shouldIdle !== idle) {
    idle = shouldIdle;
    document.body.classList.toggle("idle", idle);
  }
  if (!idle) {
    ticks += 1;
    if (tick !== null) tick.textContent = String(ticks);
  }
  requestAnimationFrame(animate);
};
if ((window as { __tnPageAnimation?: boolean }).__tnPageAnimation === true) {
  document.body.classList.add("animating");
  requestAnimationFrame(animate);
}

// Announced to the game, not just to the console: a scenario has to be able to fail with "the UI
// layer never came up" rather than with four input assertions that all look like game bugs. The
// page is ready only once its rects are published, because an empty registry and a missing page
// behave identically — every touch falls through.
sendUiIntent(bridge, "ready", registry.regions().length);
console.info(
  `TN_UI_LAYER_READY:${JSON.stringify({ regions: registry.regions().length, transport: bridge.transport })}`,
);
