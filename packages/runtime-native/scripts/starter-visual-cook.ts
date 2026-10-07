export interface IStarterVisualSnapshot {
  gltf: Record<string, unknown>;
  postGraph: unknown;
  tier: string;
  removedExtensions: string[];
  lights: {
    type: string;
    color: number[];
    intensity: number;
    position: number[];
    target: number[];
  }[];
  camera: {
    fov: number;
    aspect: number;
    near: number;
    far: number;
    zoom: number;
    position: number[];
    quaternion: number[];
  };
}

export function stripCookedExtensions(value: unknown, removed = new Set<string>()): string[] {
  if (value === null || typeof value !== "object") return [...removed].sort();
  const record = value as Record<string, unknown>;
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (Array.isArray(record[key])) for (const name of record[key]) removed.add(String(name));
    delete record[key];
  }
  if (record.extensions && typeof record.extensions === "object") {
    for (const name of Object.keys(record.extensions)) removed.add(name);
    record.extensions = undefined;
  }
  for (const child of Object.values(record)) stripCookedExtensions(child, removed);
  return [...removed].sort();
}
