import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { MULTITOUCH_PROOF_POINTS } from "./android-touch.mjs";

/**
 * The desktop multitouch injector — the third lane for a proof that already had two.
 *
 * The browser lane dispatches `PointerEvent`s on the canvas; the Android lane writes the Linux
 * `ABS_MT_*` protocol with `sendevent`. The desktop host has parsed `SDL_EVENT_FINGER_DOWN` and
 * dispatched it as a `PointerEvent` with `pointerType: "touch"` since `processTouchEvent`
 * landed, so a two-finger contact on a Linux desktop window would already reach the game.
 * Nothing in this repository had ever delivered one, which is why the desktop lane carries a
 * registry exclusion and can never exit `0`.
 *
 * This writes the *same* protocol the Android lane writes, into a virtual device it creates.
 * `MULTITOUCH_PROOF_POINTS` and `isMultitouchProofSatisfied` are imported, never re-derived: a
 * third copy of either would be a fork, and a fork drifts silently.
 *
 * Linux only. `uinput` is a Linux kernel interface and nothing here covers macOS or Windows.
 */

const EV_SYN = 0;
const EV_KEY = 1;
const EV_ABS = 3;
export const ABS_MT_SLOT = 47;
export const ABS_MT_POSITION_X = 53;
export const ABS_MT_POSITION_Y = 54;
export const ABS_MT_TRACKING_ID = 57;
export const BTN_TOUCH = 330;
export const SYN_REPORT = 0;

/** Matches TN_ABS_MAX in tools/uinput_touch_device.c. Absolute device units, not pixels. */
export const ABS_MAX = 65_535;

const EVENT_BYTES = 24;

/**
 * One `input_event`: `struct timeval time; __u16 type; __u16 code; __s32 value;`
 *
 * The kernel timestamps events itself when `time` is zero, so leaving it zero is both correct
 * and what keeps two contacts in one frame rather than in two the harness invented.
 */
export function encodeEvent(type, code, value) {
  const event = Buffer.alloc(EVENT_BYTES);
  event.writeUInt16LE(type, 16);
  event.writeUInt16LE(code, 18);
  event.writeInt32LE(value, 20);
  return event;
}

/**
 * Where the window under test actually sits, in the injector's absolute coordinate space.
 *
 * The Android lane paid for this once: `wm size` letterboxes a display into a band of the panel
 * while the touch device's range always spans the whole panel, so contacts placed as if the
 * range were the viewport landed outside it and the app saw nothing. The desktop lane has the
 * same hazard for the same reason — the virtual device's range is the whole screen and the
 * window is a rectangle inside it — so geometry is read, never assumed.
 */
export function scaleToWindow(point, geometry) {
  for (const [key, value] of Object.entries(geometry))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(
        `TN_DESKTOP_TOUCH_GEOMETRY_INVALID: window ${key} is ${value}. Read the window's real position and size; do not assume full screen.`,
      );
  if (geometry.width === 0 || geometry.height === 0)
    throw new Error(
      "TN_DESKTOP_TOUCH_GEOMETRY_INVALID: the window under test has zero area, so no contact can be aimed at it.",
    );
  const screenX = geometry.x + point.x * geometry.width;
  const screenY = geometry.y + point.y * geometry.height;
  return {
    x: Math.round((screenX / geometry.screenWidth) * ABS_MAX),
    y: Math.round((screenY / geometry.screenHeight) * ABS_MAX),
  };
}

/**
 * Both contacts down, in one `SYN_REPORT` frame.
 *
 * This is the whole assertion. The shared proof contract requires `simultaneous` — the stick
 * half and the jump half held within the same frame — and two sequential one-finger touches go
 * red against it on purpose. Emitting a `SYN_REPORT` between the two slots would turn this into
 * exactly that sequential case, which is why the frame boundary is a property a test asserts
 * rather than a comment.
 */
export function encodeSimultaneousContacts(points, geometry) {
  if (!Array.isArray(points) || points.length < 2)
    throw new Error(
      `TN_DESKTOP_TOUCH_POINTS_INVALID: a simultaneous-contact frame needs at least two points, got ${points?.length ?? 0}.`,
    );
  const events = [];
  points.forEach((point, slot) => {
    const scaled = scaleToWindow(point, geometry);
    events.push(
      encodeEvent(EV_ABS, ABS_MT_SLOT, slot),
      encodeEvent(EV_ABS, ABS_MT_TRACKING_ID, point.id),
      encodeEvent(EV_ABS, ABS_MT_POSITION_X, scaled.x),
      encodeEvent(EV_ABS, ABS_MT_POSITION_Y, scaled.y),
    );
  });
  events.push(encodeEvent(EV_KEY, BTN_TOUCH, 1), encodeEvent(EV_SYN, SYN_REPORT, 0));
  return Buffer.concat(events);
}

/** Both contacts lifted, in one frame. `-1` is the tracking id that releases a slot. */
export function encodeRelease(points) {
  const events = [];
  points.forEach((_point, slot) => {
    events.push(
      encodeEvent(EV_ABS, ABS_MT_SLOT, slot),
      encodeEvent(EV_ABS, ABS_MT_TRACKING_ID, -1),
    );
  });
  events.push(encodeEvent(EV_KEY, BTN_TOUCH, 0), encodeEvent(EV_SYN, SYN_REPORT, 0));
  return Buffer.concat(events);
}

/** Decodes a byte stream back into events, so a test can read what was actually written. */
export function decodeEvents(buffer) {
  if (buffer.length % EVENT_BYTES !== 0)
    throw new Error(
      `TN_DESKTOP_TOUCH_STREAM_MALFORMED: ${buffer.length} bytes is not a whole number of ${EVENT_BYTES}-byte events.`,
    );
  const events = [];
  for (let offset = 0; offset < buffer.length; offset += EVENT_BYTES)
    events.push({
      code: buffer.readUInt16LE(offset + 18),
      type: buffer.readUInt16LE(offset + 16),
      value: buffer.readInt32LE(offset + 20),
    });
  return events;
}

export const HELPER_NAME = "threenative-uinput-touch";

/**
 * Finds the helper beside the runtime binary under test. `TN_RUNTIME` already points at that
 * binary for every desktop conformance run, so the helper is wherever `pnpm native:build` put
 * it, and an absent helper is a loud failure rather than a skipped row.
 */
export function helperPath(runtime = process.env.TN_RUNTIME) {
  const explicit = process.env.TN_UINPUT_TOUCH;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (runtime === undefined || runtime.length === 0)
    throw new Error(
      `TN_DESKTOP_TOUCH_HELPER_MISSING: neither TN_UINPUT_TOUCH nor TN_RUNTIME is set, so ${HELPER_NAME} cannot be located.`,
    );
  return path.join(path.dirname(runtime), HELPER_NAME);
}

/**
 * Creates the virtual touchscreen and hands back a writer.
 *
 * Resolves only once the helper reports the kernel has created the device. It does not sleep a
 * guessed interval: the settle delay is real, and a race here is a flake later.
 */
export function openVirtualTouchDevice(options = {}) {
  const helper = options.helper ?? helperPath();
  if (!existsSync(helper))
    throw new Error(
      `TN_DESKTOP_TOUCH_HELPER_MISSING: ${helper} does not exist. Run pnpm native:build; the desktop lane already requires it for TN_RUNTIME.`,
    );
  const child = spawn(helper, [], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(error);
    };
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            `TN_DESKTOP_TOUCH_SETTLE_TIMEOUT: ${helper} did not report a created device within ${options.settleMs ?? 10_000}ms. stderr: ${stderr.trim() || "(empty)"}`,
          ),
        ),
      options.settleMs ?? 10_000,
    );
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("ready") || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        // Closing stdin is what destroys the device: the helper falls out of its read loop and
        // issues UI_DEV_DESTROY. A stale virtual touchscreen surviving a thrown injection would
        // leave the next run aiming at the wrong device.
        close: () =>
          new Promise((done) => {
            child.once("exit", () => done(stderr));
            child.stdin.end();
            setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
          }),
        stderr: () => stderr,
        write: (buffer) =>
          new Promise((written, failed) =>
            child.stdin.write(buffer, (error) => (error ? failed(error) : written())),
          ),
      });
    });
    child.once("error", (error) =>
      fail(
        new Error(`TN_DESKTOP_TOUCH_HELPER_FAILED: ${helper} could not be started: ${error.message}`),
      ),
    );
    child.once("exit", (code) => {
      if (settled) return;
      clearTimeout(timer);
      // Exit 2 is the helper's "cannot open /dev/uinput". It must reach the runner as a blocked
      // row naming the permission, never as a failed proof and never as a pass.
      fail(
        new Error(
          code === 2
            ? `TN_DESKTOP_TOUCH_UINPUT_UNAVAILABLE: ${stderr.trim() || "/dev/uinput could not be opened."}`
            : `TN_DESKTOP_TOUCH_HELPER_FAILED: ${helper} exited ${code}. stderr: ${stderr.trim() || "(empty)"}`,
        ),
      );
    });
  });
}

/**
 * Places both proof contacts on the window, holds them, and lifts them.
 *
 * The hold matters: the scene reads `pointers` as a *current* observation, so contacts that go
 * down and up inside one frame satisfy the latching halves of the contract and fail the parts
 * that make it a simultaneous-touch proof.
 */
export async function injectMultitouchProof(geometry, options = {}) {
  const points = options.points ?? MULTITOUCH_PROOF_POINTS;
  const device = options.device ?? (await openVirtualTouchDevice(options));
  try {
    await device.write(encodeSimultaneousContacts(points, geometry));
    await new Promise((resolve) => setTimeout(resolve, options.holdMs ?? 900));
    await device.write(encodeRelease(points));
    return { held: options.holdMs ?? 900, points: points.length };
  } finally {
    await device.close();
  }
}
