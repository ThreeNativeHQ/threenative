import { useEffect, useState } from "react";

export type DebugSnapshot = Record<string, Record<string, unknown>>;

type DevWindow = Window & {
  __THREENATIVE__?: { snapshot(): DebugSnapshot };
};

const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

function readSnapshot(): DebugSnapshot {
  return (globalThis.window as DevWindow | undefined)?.__THREENATIVE__?.snapshot() ?? {};
}

function displayValue(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? String(value));
}

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DebugSnapshot>({});

  useEffect(() => {
    if (!isDev || typeof window === "undefined") return undefined;
    const hostWindow = window;
    const toggle = (event: KeyboardEvent) => {
      if (event.key === "`") setOpen((visible) => !visible);
    };
    hostWindow.addEventListener("keydown", toggle);
    const timer = hostWindow.setInterval(() => setSnapshot(readSnapshot()), 100);
    return () => {
      hostWindow.removeEventListener("keydown", toggle);
      hostWindow.clearInterval(timer);
    };
  }, []);

  if (!isDev || !open) return null;
  const rows = Object.entries(snapshot).flatMap(([entity, fields]) =>
    Object.entries(fields).map(([key, value]) => ({ entity, key, value })),
  );
  return (
    <aside
      aria-label="ThreeNative entity debug overlay"
      className="pointer-events-none fixed right-4 top-4 z-50 max-w-sm bg-slate-950/90 p-3 font-mono text-xs text-cyan-100 shadow-lg"
      data-threenative-debug-overlay="true"
    >
      <table>
        <thead>
          <tr>
            <th className="pr-4 text-left">entity</th>
            <th className="pr-4 text-left">key</th>
            <th className="text-left">value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entity, key, value }) => (
            <tr key={`${entity}.${key}`}>
              <td className="pr-4">{entity}</td>
              <td className="pr-4">{key}</td>
              <td>{displayValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
