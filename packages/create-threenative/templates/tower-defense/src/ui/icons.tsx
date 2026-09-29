import type { TowerKind } from "../balance.js";

const COLOR: Record<TowerKind, string> = {
  arc: "#b1a0ef",
  cryo: "#7acddb",
  mortar: "#f18c6d",
  sentry: "#e9c46a",
};

/** A tower's badge: the same silhouette the 3D model has, drawn in its own colour. */
export function TowerIcon({ kind, size = 34 }: { kind: TowerKind; size?: number }) {
  const c = COLOR[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <rect x="2" y="2" width="30" height="30" rx="8" fill="#0f1a16" />
      <ellipse cx="17" cy="26" rx="10" ry="3.6" fill="#293e3c" />
      {kind === "sentry" && (
        <>
          <rect x="9" y="14" width="16" height="8" rx="2" fill={c} />
          <rect x="11" y="8" width="3" height="8" fill="#52645e" />
          <rect x="20" y="8" width="3" height="8" fill="#52645e" />
        </>
      )}
      {kind === "mortar" && (
        <>
          <rect x="9" y="17" width="16" height="6" rx="2" fill={c} />
          <rect
            x="13"
            y="6"
            width="7"
            height="14"
            rx="2.5"
            fill="#52645e"
            transform="rotate(24 17 14)"
          />
        </>
      )}
      {kind === "arc" && (
        <>
          <ellipse cx="17" cy="21" rx="8" ry="2.6" fill="none" stroke={c} strokeWidth="2" />
          <ellipse cx="17" cy="16" rx="6" ry="2.2" fill="none" stroke={c} strokeWidth="2" />
          <circle cx="17" cy="9.5" r="3.6" fill={c} />
        </>
      )}
      {kind === "cryo" && (
        <>
          <rect x="9" y="9" width="6" height="14" rx="3" fill={c} />
          <rect x="19" y="9" width="6" height="14" rx="3" fill={c} />
          <rect x="11" y="6" width="12" height="3" rx="1.5" fill="#52645e" />
        </>
      )}
    </svg>
  );
}
