function assertInteger(name, value) {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer; received ${value}`);
  }
}

export function makePageKey(level, x, y) {
  assertInteger('level', level);
  assertInteger('x', x);
  assertInteger('y', y);
  return `${level}:${x}:${y}`;
}

export function parsePageKey(key) {
  if (typeof key !== 'string') {
    throw new TypeError('page key must be a string');
  }

  const parts = key.split(':').map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) {
    throw new TypeError(`invalid page key: ${key}`);
  }

  return { level: parts[0], x: parts[1], y: parts[2] };
}

export class PhysicalPagePool {
  constructor({ pagesPerAxis }) {
    assertInteger('pagesPerAxis', pagesPerAxis);
    if (pagesPerAxis <= 0 || pagesPerAxis > 255) {
      throw new RangeError('pagesPerAxis must be between 1 and 255');
    }

    this.pagesPerAxis = pagesPerAxis;
    this.capacity = pagesPerAxis * pagesPerAxis;
    this.evictions = 0;
    this.overflow = 0;
    this._generation = 0;
    this._resident = new Map();
    this._freeSlots = Array.from({ length: this.capacity }, (_, slot) => slot);
  }

  get size() {
    return this._resident.size;
  }

  has(key) {
    return this._resident.has(key);
  }

  get(key) {
    return this._resident.get(key);
  }

  entries() {
    return [...this._resident.values()].sort((a, b) => a.slot - b.slot);
  }

  allocate(key, {
    frame = 0,
    pinned = false,
    protectedKeys = new Set(),
  } = {}) {
    assertInteger('frame', frame);

    const resident = this._resident.get(key);
    if (resident) {
      resident.lastUsedFrame = frame;
      resident.pinned ||= pinned;
      return { entry: resident, reused: true, evictedKey: null };
    }

    let slot = this._freeSlots.shift();
    let evictedKey = null;

    if (slot === undefined) {
      const candidate = this.entries()
        .filter((entry) => !entry.pinned && !protectedKeys.has(entry.key))
        .sort((a, b) => (
          a.lastUsedFrame - b.lastUsedFrame || a.slot - b.slot
        ))[0];

      if (!candidate) {
        this.overflow += 1;
        return null;
      }

      slot = candidate.slot;
      evictedKey = candidate.key;
      this._resident.delete(candidate.key);
      this.evictions += 1;
    }

    const entry = {
      key,
      slot,
      slotX: slot % this.pagesPerAxis,
      slotY: Math.floor(slot / this.pagesPerAxis),
      pinned: Boolean(pinned),
      dirty: true,
      generation: ++this._generation,
      lastUsedFrame: frame,
    };

    this._resident.set(key, entry);
    return { entry, reused: false, evictedKey };
  }

  touch(key, frame) {
    assertInteger('frame', frame);
    const entry = this._resident.get(key);
    if (!entry) return false;
    entry.lastUsedFrame = frame;
    return true;
  }

  markDirty(key) {
    const entry = this._resident.get(key);
    if (!entry) return false;
    entry.dirty = true;
    return true;
  }

  markAllDirty() {
    for (const entry of this._resident.values()) {
      entry.dirty = true;
    }
    return this._resident.size;
  }

  release(key) {
    const entry = this._resident.get(key);
    if (!entry) return false;

    this._resident.delete(key);
    this._freeSlots.push(entry.slot);
    this._freeSlots.sort((a, b) => a - b);
    return true;
  }

  clear() {
    this._resident.clear();
    this._freeSlots = Array.from({ length: this.capacity }, (_, slot) => slot);
  }
}
