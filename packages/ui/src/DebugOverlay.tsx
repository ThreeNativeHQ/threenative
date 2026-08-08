import { type CSSProperties, useEffect, useState } from "react";

export type DebugSnapshot = Record<string, Record<string, unknown>>;

type DevWindow = Window & {
  __THREENATIVE__?: { snapshot?: () => DebugSnapshot };
};

const isDev = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;

/*
 * Styled inline rather than with Tailwind classes. CHARTER.md §6b mandates
 * Tailwind for the game's own HUD, which the scaffold wires up; but this
 * overlay ships inside the package and lands in consumers that may have no
 * Tailwind at all, where class names are inert strings. Inline styles need no
 * build step, no CSS import, and no consumer config. GameCanvas already does
 * the same.
 */
const panelStyle: CSSProperties = {
  background: "rgb(2 6 23 / 90%)",
  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 30%)",
  color: "#cffafe",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "12px",
  lineHeight: 1.5,
  maxWidth: "24rem",
  padding: "12px",
  pointerEvents: "none",
  position: "fixed",
  right: "16px",
  top: "16px",
  zIndex: 50,
};

// Fixed layout plus break-all: snapshot values are arbitrary JSON and would
// otherwise push the table past the panel edge.
const tableStyle: CSSProperties = { tableLayout: "fixed", width: "100%" };
const headerCellStyle: CSSProperties = { paddingRight: "16px", textAlign: "left" };
const cellStyle: CSSProperties = { paddingRight: "16px" };
const lastCellStyle: CSSProperties = { textAlign: "left" };
const valueCellStyle: CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-all" };

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
      data-threenative-debug-overlay="true"
      style={panelStyle}
    >
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={headerCellStyle}>entity</th>
            <th style={headerCellStyle}>key</th>
            <th style={lastCellStyle}>value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entity, key, value }) => (
            <tr key={`${entity}.${key}`}>
              <td style={cellStyle}>{entity}</td>
              <td style={cellStyle}>{key}</td>
              <td style={valueCellStyle}>{displayValue(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
