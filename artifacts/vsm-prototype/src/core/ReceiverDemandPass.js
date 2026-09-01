function distanceSquared2D(a, b) {
  const dx = a.u - b.u;
  const dy = a.v - b.v;
  return dx * dx + dy * dy;
}

function boundsSamplePoints(bounds) {
  const { min, max } = bounds;
  const center = {
    x: (min.x + max.x) * 0.5,
    y: (min.y + max.y) * 0.5,
    z: (min.z + max.z) * 0.5,
  };
  return [
    center,
    { x: min.x, y: min.y, z: min.z },
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: max.z },
    { x: min.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: max.z },
    { x: max.x, y: max.y, z: min.z },
    { x: max.x, y: max.y, z: max.z },
  ];
}

export class ReceiverDemandPass {
  constructor({ columns = 15, rows = 9, guardBand = 1 } = {}) {
    if (!Number.isInteger(columns) || columns <= 0) {
      throw new TypeError('columns must be a positive integer');
    }
    if (!Number.isInteger(rows) || rows <= 0) {
      throw new TypeError('rows must be a positive integer');
    }
    if (!Number.isInteger(guardBand) || guardBand < 0) {
      throw new TypeError('guardBand must be a non-negative integer');
    }
    this.columns = columns;
    this.rows = rows;
    this.guardBand = guardBand;
  }

  collect({
    camera,
    receiverPlaneY = 0,
    visibleBounds = [],
    clipmap,
  }) {
    if (typeof camera?.sampleGroundPoints !== 'function') {
      throw new TypeError('camera must expose sampleGroundPoints(columns, rows, planeY)');
    }
    if (!camera.position) {
      throw new TypeError('camera must expose a position vector');
    }

    const requests = new Map();
    const cameraLight = clipmap.project(camera.position);

    const addRequest = ({ level, x, y, key }, { pinned = false, priority = 0 } = {}) => {
      if (!clipmap.containsPage(level, x, y)) return;
      const existing = requests.get(key);
      if (!existing) {
        requests.set(key, { key, level, x, y, pinned, priority });
        return;
      }
      existing.pinned ||= pinned;
      existing.priority = Math.min(existing.priority, priority);
    };

    const addPoint = (point) => {
      const level = clipmap.selectLevel(point);
      const page = clipmap.worldToPage(point, level);
      const projected = clipmap.project(point);
      const basePriority = distanceSquared2D(projected, cameraLight);

      for (let dx = -this.guardBand; dx <= this.guardBand; dx += 1) {
        for (let dy = -this.guardBand; dy <= this.guardBand; dy += 1) {
          const x = page.x + dx;
          const y = page.y + dy;
          addRequest(
            { level, x, y, key: `${level}:${x}:${y}` },
            { priority: basePriority + (dx * dx + dy * dy) * 0.001 },
          );
        }
      }
    };

    const sampledPoints = camera.sampleGroundPoints(
      this.columns,
      this.rows,
      receiverPlaneY,
    );
    for (const point of sampledPoints) addPoint(point);
    addPoint({
      x: camera.position.x,
      y: receiverPlaneY,
      z: camera.position.z,
    });

    for (const bounds of visibleBounds) {
      for (const point of boundsSamplePoints(bounds)) addPoint(point);
    }

    const coarsestLevel = clipmap.levelCount - 1;
    for (const page of clipmap.windowPages(coarsestLevel)) {
      addRequest(page, { pinned: true, priority: -1 });
    }

    return [...requests.values()].sort((a, b) => (
      Number(b.pinned) - Number(a.pinned)
      || a.level - b.level
      || a.priority - b.priority
      || a.x - b.x
      || a.y - b.y
    ));
  }
}
