import { useEffect, useState } from "react";

export type DebugSnapshot = Record<string, Record<string, unknown>>;

type DevWindow = Window & Partial<Record<"__THREENATIVE__", { snapshot?: () => DebugSnapshot }>>;

const isDev =
  (import.meta as ImportMeta & { env?: Record<"DEV", boolean | undefined> }).env?.DEV === true;

function readSnapshot(): DebugSnapshot {
  const snapshot = (globalThis.window as DevWindow | undefined)?.__THREENATIVE__?.snapshot;
  return typeof snapshot === "function" ? snapshot() : {};
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
    return () => {
      hostWindow.removeEventListener("keydown", toggle);
    };
  }, []);

  useEffect(() => {
    if (!isDev || typeof window === "undefined" || !open) return undefined;
    const timer = window.setInterval(() => setSnapshot(readSnapshot()), 100);
    return () => window.clearInterval(timer);
  }, [open]);

  if (!isDev || !open) return null;
  const rows = Object.entries(snapshot).flatMap(([entity, fields]) =>
    Object.entries(fields).map(([key, value]) => ({ entity, key, value })),
  );
  return (
    <aside aria-label="ThreeNative entity debug overlay" data-threenative-debug-overlay="true">
      <table>
        <thead>
          <tr>
            <th>entity</th>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entity, key, value }) => (
            <tr key={`${entity}.${key}`}>
              <td>{entity}</td>
              <td>{key}</td>
              <td>{displayValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
