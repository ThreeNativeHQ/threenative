import { makePageKey } from './PhysicalPagePool.js';

const EPSILON = 1e-9;

function assertPositiveInteger(name, value) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer; received ${value}`);
  }
}

function assertFiniteVector(name, vector) {
  if (!vector || !['x', 'y', 'z'].every((axis) => Number.isFinite(vector[axis]))) {
    throw new TypeError(`${name} must contain finite x, y and z values`);
  }
}

function copyVector(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(vector) {
  return Math.sqrt(dot(vector, vector));
}

function normalize(vector) {
  const magnitude = length(vector);
  if (magnitude <= EPSILON) {
    throw new RangeError('lightDirection must have non-zero length');
  }
  return {
    x: vector.x / magnitude,
    y: vector.y / magnitude,
    z: vector.z / magnitude,
  };
}

function addScaled(target, vector, scale) {
  target.x += vector.x * scale;
  target.y += vector.y * scale;
  target.z += vector.z * scale;
  return target;
}

function cornersOfBounds(bounds) {
  if (!bounds?.min || !bounds?.max) {
    throw new TypeError('bounds must provide min and max vectors');
  }
  assertFiniteVector('bounds.min', bounds.min);
  assertFiniteVector('bounds.max', bounds.max);

  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corners.push({ x, y, z });
      }
    }
  }
  return corners;
}

export class DirectionalClipmap {
  constructor({
    lightDirection,
    clipExtents = [18, 42, 90, 180],
    pagesPerAxis = 8,
    selectionGuard = 0.9,
  }) {
    assertFiniteVector('lightDirection', lightDirection);
    assertPositiveInteger('pagesPerAxis', pagesPerAxis);
    if (!Array.isArray(clipExtents) || clipExtents.length === 0) {
      throw new TypeError('clipExtents must be a non-empty array');
    }
    if (clipExtents.some((extent) => !Number.isFinite(extent) || extent <= 0)) {
      throw new RangeError('every clip extent must be positive');
    }
    if (!Number.isFinite(selectionGuard) || selectionGuard <= 0 || selectionGuard > 1) {
      throw new RangeError('selectionGuard must be in the range (0, 1]');
    }

    this.clipExtents = [...clipExtents];
    this.pagesPerAxis = pagesPerAxis;
    this.selectionGuard = selectionGuard;
    this.levelCount = clipExtents.length;

    this.basisW = normalize(lightDirection);
    const reference = Math.abs(this.basisW.y) > 0.95
      ? { x: 0, y: 0, z: 1 }
      : { x: 0, y: 1, z: 0 };
    this.basisU = normalize(cross(this.basisW, reference));
    // Right-handed (U x V = W): a page camera placed along +W with up = V then renders
    // screen X = V x W = +U, matching the +u atlas lookup. The previous U x W basis was
    // left-handed and mirrored every rendered page along u against the sampler.
    this.basisV = normalize(cross(this.basisW, this.basisU));

    this.centerWorld = { x: 0, y: 0, z: 0 };
    this.centerLight = { u: 0, v: 0, w: 0 };
    this._windows = [];
    this.updateCenter(this.centerWorld);
  }

  project(worldPoint) {
    assertFiniteVector('worldPoint', worldPoint);
    return {
      u: dot(worldPoint, this.basisU),
      v: dot(worldPoint, this.basisV),
      w: dot(worldPoint, this.basisW),
    };
  }

  unproject({ u, v, w = 0 }) {
    if (![u, v, w].every(Number.isFinite)) {
      throw new TypeError('light-space coordinates must be finite');
    }
    const world = { x: 0, y: 0, z: 0 };
    addScaled(world, this.basisU, u);
    addScaled(world, this.basisV, v);
    addScaled(world, this.basisW, w);
    return world;
  }

  updateCenter(worldPoint) {
    this.centerWorld = copyVector(worldPoint);
    this.centerLight = this.project(worldPoint);
    const halfPages = Math.floor(this.pagesPerAxis / 2);

    this._windows = this.clipExtents.map((extent, level) => {
      const pageWorldSize = (extent * 2) / this.pagesPerAxis;
      const centerPageX = Math.floor(this.centerLight.u / pageWorldSize);
      const centerPageY = Math.floor(this.centerLight.v / pageWorldSize);
      const minX = centerPageX - halfPages;
      const minY = centerPageY - halfPages;
      return {
        level,
        extent,
        pageWorldSize,
        centerPageX,
        centerPageY,
        minX,
        minY,
        maxX: minX + this.pagesPerAxis,
        maxY: minY + this.pagesPerAxis,
      };
    });

    return this._windows;
  }

  getWindow(level) {
    const window = this._windows[level];
    if (!window) throw new RangeError(`invalid clip level: ${level}`);
    return { ...window };
  }

  pageWorldSize(level) {
    return this.getWindow(level).pageWorldSize;
  }

  containsPage(level, x, y) {
    const window = this._windows[level];
    return Boolean(window)
      && x >= window.minX
      && x < window.maxX
      && y >= window.minY
      && y < window.maxY;
  }

  worldToPage(worldPoint, level) {
    const window = this._windows[level];
    if (!window) throw new RangeError(`invalid clip level: ${level}`);
    const projected = this.project(worldPoint);
    const x = Math.floor(projected.u / window.pageWorldSize);
    const y = Math.floor(projected.v / window.pageWorldSize);
    return { level, x, y, key: makePageKey(level, x, y) };
  }

  selectLevel(worldPoint) {
    const projected = this.project(worldPoint);
    const distance = Math.max(
      Math.abs(projected.u - this.centerLight.u),
      Math.abs(projected.v - this.centerLight.v),
    );

    for (let level = 0; level < this.levelCount; level += 1) {
      if (distance <= this.clipExtents[level] * this.selectionGuard) {
        return level;
      }
    }
    return this.levelCount - 1;
  }

  pageBounds(level, x, y) {
    const pageWorldSize = this.pageWorldSize(level);
    const minU = x * pageWorldSize;
    const minV = y * pageWorldSize;
    const maxU = minU + pageWorldSize;
    const maxV = minV + pageWorldSize;
    return {
      level,
      x,
      y,
      minU,
      minV,
      maxU,
      maxV,
      centerU: (minU + maxU) * 0.5,
      centerV: (minV + maxV) * 0.5,
      pageWorldSize,
      centerWorld: this.unproject({
        u: (minU + maxU) * 0.5,
        v: (minV + maxV) * 0.5,
        w: 0,
      }),
    };
  }

  boundsToPageRange(bounds, level) {
    const window = this._windows[level];
    if (!window) throw new RangeError(`invalid clip level: ${level}`);
    const projected = cornersOfBounds(bounds).map((corner) => this.project(corner));
    const minU = Math.min(...projected.map(({ u }) => u));
    const maxU = Math.max(...projected.map(({ u }) => u));
    const minV = Math.min(...projected.map(({ v }) => v));
    const maxV = Math.max(...projected.map(({ v }) => v));
    const pageSize = window.pageWorldSize;

    return {
      minX: Math.floor(minU / pageSize),
      maxX: Math.floor((maxU - EPSILON) / pageSize),
      minY: Math.floor(minV / pageSize),
      maxY: Math.floor((maxV - EPSILON) / pageSize),
    };
  }

  boundsToPageKeys(bounds, level) {
    const range = this.boundsToPageRange(bounds, level);
    const keys = [];
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        keys.push(makePageKey(level, x, y));
      }
    }
    return keys;
  }

  windowPages(level) {
    const window = this._windows[level];
    if (!window) throw new RangeError(`invalid clip level: ${level}`);
    const pages = [];
    for (let x = window.minX; x < window.maxX; x += 1) {
      for (let y = window.minY; y < window.maxY; y += 1) {
        pages.push({ level, x, y, key: makePageKey(level, x, y) });
      }
    }
    return pages;
  }
}
