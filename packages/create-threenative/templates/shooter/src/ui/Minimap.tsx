import type { ITownSchematic, SchematicRect } from "../render/town.js";
import type { Blip } from "../state.js";

// One SVG unit is one metre. North (-z) points up, east (+x) right, so a world
// point lands at SVG (x, z) directly — +z (south) draws downward. Every rect,
// label and extent arrives as plain data in the `schematic` prop emitted by the
// town builder (see ITownSchematic); this component owns only how that data is
// presented and the live state drawn on top of it.
const VIEW_CONE_RADIUS = 26; // metres
const VIEW_CONE_HALF_ANGLE = Math.PI / 6; // 30 deg each side of facing
const DOT_CLAMP = 45; // metres from centre; keeps dots just inside the disc rim

function AreaRect({ rect, raised }: { rect: SchematicRect; raised?: boolean }) {
  const [x, z, width, depth] = rect;
  return (
    <rect
      x={x}
      y={z}
      width={width}
      height={depth}
      fill={raised ? "none" : "#ffffff"}
      fillOpacity={raised ? 0 : 0.05}
      stroke={raised ? "#ffd166" : "#ffffff"}
      strokeOpacity={raised ? 0.6 : 0.22}
      strokeDasharray={raised ? "3 2" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

function MapLabel({ label }: { label: ITownSchematic["labels"][number] }) {
  const site = label.kind === "site";
  return (
    <text
      x={label.x}
      y={label.z}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={site ? 9 : 5.4}
      fontWeight={site ? 700 : 600}
      fill={site ? "#ffb84d" : "#ffd166"}
      fillOpacity={site ? undefined : 0.85}
    >
      {label.text}
    </text>
  );
}

export function Minimap({
  schematic,
  playerX,
  playerZ,
  playerYaw,
  blips,
}: {
  schematic: ITownSchematic;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  blips: readonly Blip[];
}) {
  // yaw=0 faces -z (map up); forward matches FpsPlayer: (-sin yaw, -cos yaw).
  // Expressed as an SVG-screen angle for the view cone.
  const facing = Math.atan2(-Math.cos(playerYaw), -Math.sin(playerYaw));
  const coneEdge = (angle: number) => {
    const ex = playerX + VIEW_CONE_RADIUS * Math.cos(angle);
    const ez = playerZ + VIEW_CONE_RADIUS * Math.sin(angle);
    return `${ex.toFixed(1)} ${ez.toFixed(1)}`;
  };

  return (
    <div className="hud-minimap pointer-events-none absolute left-4 top-4 h-[180px] w-[180px] rounded-full bg-black/55 shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-1 ring-[#ffa63d]/40">
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <clipPath id="bayview-map-disc">
            <circle cx="0" cy="0" r="49" />
          </clipPath>
        </defs>
        <g clipPath="url(#bayview-map-disc)">
          {/* Sea east of the deck edge, and the dock pier reaching into it. */}
          <rect x={schematic.sea.edgeX} y={-50} width={8} height={100} fill="#5b93b8" opacity={0.35} />
          <line
            x1={schematic.pier.ax}
            y1={schematic.pier.az}
            x2={schematic.pier.bx}
            y2={schematic.pier.bz}
            stroke="#c9a06a"
            strokeOpacity={0.75}
            strokeWidth={1.6}
            strokeLinecap="round"
          />

          {/* Deck outline, lanes and plazas, raised decks, callout labels —
              all traced from the builder's schematic. */}
          <rect
            x={-schematic.deck.half}
            y={-schematic.deck.half}
            width={schematic.deck.half * 2}
            height={schematic.deck.half * 2}
            fill="#ffffff"
            fillOpacity={0.04}
            stroke="#ffffff"
            strokeOpacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
          {schematic.areas.map((rect) => (
            <AreaRect key={rect.join(",")} rect={rect} />
          ))}
          {schematic.raised.map((rect) => (
            <AreaRect key={rect.join(",")} rect={rect} raised />
          ))}
          {schematic.labels.map((label) => (
            <MapLabel key={label.text} label={label} />
          ))}

          {/* Facing cone, live enemy dots, player dot on top. */}
          <path
            d={`M ${playerX.toFixed(1)} ${playerZ.toFixed(1)} L ${coneEdge(facing - VIEW_CONE_HALF_ANGLE)} A ${VIEW_CONE_RADIUS} ${VIEW_CONE_RADIUS} 0 0 1 ${coneEdge(facing + VIEW_CONE_HALF_ANGLE)} Z`}
            fill="#ffc861"
            fillOpacity={0.16}
          />
          {blips.map((blip, index) => {
            if (!blip.alive) return null;
            const distance = Math.hypot(blip.x, blip.z);
            const clamp = distance > DOT_CLAMP ? DOT_CLAMP / distance : 1;
            return (
              <circle
                key={index}
                cx={(blip.x * clamp).toFixed(1)}
                cy={(blip.z * clamp).toFixed(1)}
                r={2}
                fill="#ff5f4d"
              />
            );
          })}
          <circle cx={playerX} cy={playerZ} r={2.4} fill="#ffd166" stroke="#3a2a08" strokeWidth={0.8} />
        </g>
      </svg>
      <div className="absolute left-1/2 top-[7px] -translate-x-1/2 text-[9px] font-bold tracking-[0.2em] text-white/55">
        N
      </div>
    </div>
  );
}
