const EV_SYN = 0;
const EV_KEY = 1;
const EV_ABS = 3;
const ABS_MT_SLOT = 47;
const ABS_MT_TOUCH_MAJOR = 48;
const ABS_MT_TOUCH_MINOR = 49;
const ABS_MT_TRACKING_ID = 57;
const ABS_MT_POSITION_X = 53;
const ABS_MT_POSITION_Y = 54;
const ABS_MT_TOOL_TYPE = 55;
const ABS_MT_PRESSURE = 58;
const BTN_TOUCH = 330;
const BTN_TOOL_FINGER = 325;
const SYN_REPORT = 0;

export const MULTITOUCH_PROOF_POINTS = [
  { id: 7, x: 0.2, y: 0.5 },
  { id: 3, x: 0.8, y: 0.5 },
];

export const MULTITOUCH_PROOF_ROTATION = 1;

export function parseAndroidTouchDevice(output, preferredPath) {
  const devices = output
    .split(/(?=^add device \d+:)/mu)
    .map((block) => {
      const path = /^add device \d+:\s+(\S+)/mu.exec(block)?.[1];
      if (path === undefined) return undefined;
      const name = /^\s*name:\s*"([^"]*)"/mu.exec(block)?.[1] ?? path;
      const slot = absoluteRange(block, "ABS_MT_SLOT");
      const x = absoluteRange(block, "ABS_MT_POSITION_X");
      const y = absoluteRange(block, "ABS_MT_POSITION_Y");
      if (slot === undefined || x === undefined || y === undefined) return undefined;
      return { name, path, slot, x, y };
    })
    .filter((device) => device !== undefined);
  if (preferredPath !== undefined) {
    const preferred = devices.find((device) => device.path === preferredPath);
    if (preferred !== undefined) return preferred;
    throw new Error(`Android touch device '${preferredPath}' was not found in getevent output.`);
  }
  const device = devices.find((candidate) => /touch|screen|finger/iu.test(candidate.name)) ?? devices[0];
  if (device === undefined) {
    throw new Error(
      "Android multitouch injection requires an input device with ABS_MT_SLOT, ABS_MT_POSITION_X, and ABS_MT_POSITION_Y.",
    );
  }
  return device;
}

export function androidMultitouchScript(device, points, down, rotation = 0) {
  if (!/^\/dev\/input\/event\d+$/u.test(device.path)) {
    throw new Error(`Refusing to send Android input events to unexpected path '${device.path}'.`);
  }
  const events = [];
  for (const [index, point] of points.entries()) {
    events.push(
      [EV_ABS, ABS_MT_SLOT, device.slot.min + index],
      [EV_ABS, ABS_MT_TRACKING_ID, down ? point.id : -1],
    );
    if (down) {
      const coordinates = orientedCoordinates(point.x, point.y, rotation);
      events.push(
        [EV_ABS, ABS_MT_TOOL_TYPE, 0],
        [EV_ABS, ABS_MT_TOUCH_MAJOR, 1],
        [EV_ABS, ABS_MT_TOUCH_MINOR, 1],
        [EV_ABS, ABS_MT_PRESSURE, 512],
        [EV_ABS, ABS_MT_POSITION_X, coordinate(coordinates.x, device.x)],
        [EV_ABS, ABS_MT_POSITION_Y, coordinate(coordinates.y, device.y)],
      );
    }
  }
  events.push(
    [EV_KEY, BTN_TOUCH, down ? 1 : 0],
    [EV_KEY, BTN_TOOL_FINGER, down ? 1 : 0],
    [EV_SYN, SYN_REPORT, 0],
  );
  return [
    "set -e",
    "send_event() {",
    "  if su 0 id >/dev/null 2>&1; then",
    "    su 0 sendevent \"$@\"",
    "  else",
    "    sendevent \"$@\"",
    "  fi",
    "}",
    ...events.map(([type, code, value]) => `send_event ${device.path} ${type} ${code} ${value}`),
  ].join("\n");
}

function absoluteRange(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(
    `^\\s*(?:[A-Z_]+\\s+\\([^)]*\\)\\s*:\\s*)?${escaped}(?:\\s+\\([^)]*\\))?\\s*:\\s*.*?\\bmin\\s+(-?\\d+),\\s+max\\s+(-?\\d+)`,
    "mu",
  ).exec(block);
  if (match === null) return undefined;
  return { max: Number(match[2]), min: Number(match[1]) };
}

function coordinate(value, range) {
  const normalized = Math.max(0, Math.min(1, value));
  return Math.round(range.min + normalized * (range.max - range.min));
}

function orientedCoordinates(x, y, rotation) {
  switch (rotation) {
    case 1:
      return { x: 1 - y, y: x };
    case 2:
      return { x: 1 - x, y: 1 - y };
    case 3:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}
