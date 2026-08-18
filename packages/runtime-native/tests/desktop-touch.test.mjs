import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { rmSync, writeFileSync, chmodSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MULTITOUCH_PROOF_POINTS } from "../conformance/android-touch.mjs";
import {
  ABS_MAX,
  ABS_MT_POSITION_X,
  ABS_MT_POSITION_Y,
  ABS_MT_SLOT,
  ABS_MT_TRACKING_ID,
  BTN_TOUCH,
  SYN_REPORT,
  decodeEvents,
  encodeRelease,
  encodeSimultaneousContacts,
  helperPath,
  injectMultitouchProof,
  openVirtualTouchDevice,
  scaleToWindow,
} from "../conformance/desktop-touch.mjs";

const EV_SYN = 0;
const EV_KEY = 1;
const EV_ABS = 3;

/** A 1280x720 window offset inside a 1920x1080 screen: never the full-screen assumption. */
const GEOMETRY = { height: 720, screenHeight: 1080, screenWidth: 1920, width: 1280, x: 320, y: 180 };

const roots = [];

function fakeHelper(script) {
  const root = makeTempDirSync("threenative-uinput-fake-");
  roots.push(root);
  const file = path.join(root, "threenative-uinput-touch");
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

describe("desktop multitouch injector", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
  });

  it("should emit both contacts in one SYN_REPORT frame", () => {
    // The property that makes the contacts simultaneous rather than sequential, and the only
    // thing separating this from the two-sequential-touches case the shared proof contract is
    // built to reject.
    const events = decodeEvents(encodeSimultaneousContacts(MULTITOUCH_PROOF_POINTS, GEOMETRY));
    const syncs = events.filter((event) => event.type === EV_SYN && event.code === SYN_REPORT);
    const slots = events.filter((event) => event.type === EV_ABS && event.code === ABS_MT_SLOT);

    expect(syncs).toHaveLength(1);
    expect(slots.map((event) => event.value)).toEqual([0, 1]);
    // Both slot groups precede the single frame boundary.
    expect(events.indexOf(slots[1])).toBeLessThan(events.indexOf(syncs[0]));
    expect(
      events.filter((event) => event.code === ABS_MT_TRACKING_ID).map((event) => event.value),
    ).toEqual(MULTITOUCH_PROOF_POINTS.map((point) => point.id));
    expect(events.at(-2)).toEqual({ code: BTN_TOUCH, type: EV_KEY, value: 1 });
  });

  it("aims contacts at the window's real rectangle, not at the whole screen", () => {
    // The Android lane paid for this once: a letterboxed viewport meant contacts scaled against
    // the panel landed outside the app and dispatched to nothing.
    const [left] = MULTITOUCH_PROOF_POINTS;
    const scaled = scaleToWindow(left, GEOMETRY);
    const fullScreen = scaleToWindow(left, {
      height: 1080,
      screenHeight: 1080,
      screenWidth: 1920,
      width: 1920,
      x: 0,
      y: 0,
    });

    expect(scaled.x).toBe(Math.round(((320 + 0.2 * 1280) / 1920) * ABS_MAX));
    expect(scaled.y).toBe(Math.round(((180 + 0.5 * 720) / 1080) * ABS_MAX));
    expect(scaled).not.toEqual(fullScreen);
  });

  it("refuses geometry that was assumed rather than read", () => {
    expect(() => scaleToWindow(MULTITOUCH_PROOF_POINTS[0], { ...GEOMETRY, width: 0 })).toThrow(
      /TN_DESKTOP_TOUCH_GEOMETRY_INVALID/u,
    );
    expect(() =>
      scaleToWindow(MULTITOUCH_PROOF_POINTS[0], { ...GEOMETRY, x: Number.NaN }),
    ).toThrow(/TN_DESKTOP_TOUCH_GEOMETRY_INVALID/u);
  });

  it("refuses to encode a frame with fewer than two contacts", () => {
    // The dropped-contact control, at the encoder: one point cannot satisfy a proof whose whole
    // subject is two, so it is refused rather than written and reported as a failed proof.
    expect(() => encodeSimultaneousContacts([MULTITOUCH_PROOF_POINTS[0]], GEOMETRY)).toThrow(
      /TN_DESKTOP_TOUCH_POINTS_INVALID/u,
    );
  });

  it("releases every slot with tracking id -1 in one frame", () => {
    const events = decodeEvents(encodeRelease(MULTITOUCH_PROOF_POINTS));
    expect(
      events.filter((event) => event.code === ABS_MT_TRACKING_ID).map((event) => event.value),
    ).toEqual([-1, -1]);
    expect(events.filter((event) => event.type === EV_SYN)).toHaveLength(1);
    expect(events.at(-2)).toEqual({ code: BTN_TOUCH, type: EV_KEY, value: 0 });
  });

  it("rejects a byte stream that is not a whole number of events", () => {
    expect(() => decodeEvents(Buffer.alloc(23))).toThrow(/TN_DESKTOP_TOUCH_STREAM_MALFORMED/u);
  });

  it("should block rather than pass when /dev/uinput cannot be opened", async () => {
    // A machine that cannot inject says so. It must not be mistaken for a machine where the
    // proof failed, and it must never be mistaken for one where it passed.
    const helper = fakeHelper(
      '#!/bin/sh\necho "TN_DESKTOP_TOUCH_UINPUT_UNAVAILABLE: open /dev/uinput: Permission denied" >&2\nexit 2\n',
    );
    await expect(openVirtualTouchDevice({ helper })).rejects.toThrow(
      /TN_DESKTOP_TOUCH_UINPUT_UNAVAILABLE.*Permission denied/su,
    );
  });

  it("distinguishes an unavailable device from a helper that failed some other way", async () => {
    // The inverted control for the case above: if every non-zero exit reported
    // UINPUT_UNAVAILABLE, a broken helper would be recorded as a host permission problem and
    // the exclusion would be rewritten to blame the wrong thing.
    const helper = fakeHelper('#!/bin/sh\necho "segfault" >&2\nexit 1\n');
    await expect(openVirtualTouchDevice({ helper })).rejects.toThrow(
      /TN_DESKTOP_TOUCH_HELPER_FAILED.*exited 1/su,
    );
  });

  it("fails loudly when the helper was never built", () => {
    expect(() => helperPath("")).toThrow(/TN_DESKTOP_TOUCH_HELPER_MISSING/u);
    expect(() =>
      openVirtualTouchDevice({ helper: path.join(os.tmpdir(), "definitely-not-built") }),
    ).toThrow(/TN_DESKTOP_TOUCH_HELPER_MISSING/u);
  });

  it("waits for the kernel to report the device rather than sleeping a guessed interval", async () => {
    const helper = fakeHelper('#!/bin/sh\nsleep 5\necho ready\ncat > /dev/null\n');
    await expect(openVirtualTouchDevice({ helper, settleMs: 250 })).rejects.toThrow(
      /TN_DESKTOP_TOUCH_SETTLE_TIMEOUT/u,
    );
  });

  it("should release the virtual device on every exit path", async () => {
    // Closing stdin is what issues UI_DEV_DESTROY. A helper left running after a thrown
    // injection is a stale touchscreen the next run aims at by mistake.
    const marker = path.join(makeTempDirSync("threenative-uinput-exit-"), "gone");
    roots.push(path.dirname(marker));
    const helper = fakeHelper(`#!/bin/sh\necho ready\ncat > /dev/null\ntouch ${marker}\n`);
    const device = await openVirtualTouchDevice({ helper });

    await expect(
      injectMultitouchProof(GEOMETRY, { device, holdMs: 1, points: [MULTITOUCH_PROOF_POINTS[0]] }),
    ).rejects.toThrow(/TN_DESKTOP_TOUCH_POINTS_INVALID/u);

    const { existsSync } = await import("node:fs");
    expect(existsSync(marker)).toBe(true);
  });

  it("writes both frames and tears down on the happy path", async () => {
    const captured = path.join(
      makeTempDirSync("threenative-uinput-capture-"),
      "stream.bin",
    );
    roots.push(path.dirname(captured));
    const helper = fakeHelper(`#!/bin/sh\necho ready\ncat > ${captured}\n`);

    const result = await injectMultitouchProof(GEOMETRY, { helper, holdMs: 5 });

    const { readFileSync } = await import("node:fs");
    const events = decodeEvents(readFileSync(captured));
    expect(result.points).toBe(2);
    expect(events.filter((event) => event.type === EV_SYN)).toHaveLength(2);
    expect(
      events.filter((event) => event.code === ABS_MT_POSITION_X || event.code === ABS_MT_POSITION_Y),
    ).toHaveLength(4);
  });
});
