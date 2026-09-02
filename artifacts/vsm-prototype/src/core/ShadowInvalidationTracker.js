function copyBounds(bounds) {
  return {
    min: { ...bounds.min },
    max: { ...bounds.max },
  };
}

function boundsEqual(a, b, epsilon = 1e-6) {
  return ['x', 'y', 'z'].every((axis) => (
    Math.abs(a.min[axis] - b.min[axis]) <= epsilon
    && Math.abs(a.max[axis] - b.max[axis]) <= epsilon
  ));
}

export class ShadowInvalidationTracker {
  constructor(clipmap) {
    if (!clipmap) throw new TypeError('clipmap is required');
    this.clipmap = clipmap;
    this._tracked = new Map();
    this._invalidated = new Set();
  }

  _invalidateBounds(bounds) {
    for (let level = 0; level < this.clipmap.levelCount; level += 1) {
      for (const key of this.clipmap.boundsToPageKeys(bounds, level)) {
        this._invalidated.add(key);
      }
    }
  }

  update(id, bounds) {
    if (id === undefined || id === null) {
      throw new TypeError('tracked caster id is required');
    }
    const previous = this._tracked.get(id);
    if (previous && boundsEqual(previous, bounds)) return false;

    if (previous) this._invalidateBounds(previous);
    this._invalidateBounds(bounds);
    this._tracked.set(id, copyBounds(bounds));
    return true;
  }

  remove(id) {
    const previous = this._tracked.get(id);
    if (!previous) return false;
    this._invalidateBounds(previous);
    this._tracked.delete(id);
    return true;
  }

  invalidateAll() {
    for (const bounds of this._tracked.values()) {
      this._invalidateBounds(bounds);
    }
    return this._invalidated.size;
  }

  consumeInvalidatedKeys() {
    const result = new Set(this._invalidated);
    this._invalidated.clear();
    return result;
  }

  clear() {
    this._tracked.clear();
    this._invalidated.clear();
  }
}
