// The owned engine consumes verified TNPK entries, never browser loaders or network fallbacks.
export function createAssetLoader(options = {}) {
  if (Object.keys(options).some((key) => !["renderer", "basePath", "manifest", "sourcePath"].includes(key)))
    throw new Error("TN_NATIVE_ASSET_OPTIONS_UNSUPPORTED: this player accepts cooked package paths only");
  const cache = new Map();
  const pending = new Set();
  const resolved = new Map();
  const progress = { requested: 0, settled: 0, requestedBytes: 0, settledBytes: 0,
    get pending() { return [...pending]; } };
  const load = (kind, path, copy = false) => {
    if (typeof path !== "string" || !path || path.includes("\0"))
      return Promise.reject(new Error("TN_NATIVE_ASSET_INVALID: expected a nonempty logical path"));
    const key = `${kind}:${path}`;
    if (!copy && cache.has(key)) return cache.get(key);
    progress.requested++;
    pending.add(path);
    const result = Promise.resolve().then(() => {
      const record = globalThis.tn.loadAsset(kind, path);
      progress.requestedBytes += record.bytes;
      progress.settledBytes += record.bytes;
      resolved.set(path, { url: record.url, via: "manifest" });
      return record.value;
    }).finally(() => { pending.delete(path); progress.settled++; });
    if (!copy) cache.set(key, result);
    result.catch(() => { if (cache.get(key) === result) cache.delete(key); });
    return result;
  };
  return {
    progress, resolved,
    model: (path) => load("model", path),
    async texture(path, settings) {
      const value = await load("texture", path, settings !== undefined);
      if (settings === undefined) return value;
        if (settings.anisotropy !== undefined)
          throw new Error("TN_NATIVE_ASSET_ANISOTROPY_UNSUPPORTED: native sampler anisotropy is unbound");
        value.colorSpace = settings.data === true ? "" : "srgb";
        if (settings.wrap !== undefined) value.wrapS = value.wrapT = settings.wrap;
        if (typeof settings.repeat === "number") value.repeat.setScalar(settings.repeat);
        else if (settings.repeat !== undefined) value.repeat.set(...settings.repeat);
      return value;
    },
    audio: async () => { throw new Error("TN_NATIVE_ASSET_AUDIO_UNSUPPORTED: TNPK v1 has no audio entry"); },
    resolve: async (path) => [resolved.get(path)?.url ?? `tnpk:${path}`],
    release: (kind, path) => cache.delete(`${kind}:${path}`),
    clear() { cache.clear(); resolved.clear(); },
  };
}
