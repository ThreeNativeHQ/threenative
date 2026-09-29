import { useEffect, useRef } from "react";
import { ALTAR, KEEPER, LAKE, mulberry32 } from "../logic/layout.js";
import { BRIDGE, PATHS, STAIR } from "../logic/terrain.js";
import type { GameState } from "../state.js";

const SIZE = 300;
const S = 3.35;
const tx = (x: number): number => 150 + x * S;
const tz = (z: number): number => 150 + (z + 5) * S;

/** The land itself: paint it once. Meadow, brook, footpaths, the bridge, the stair and the great oak. */
function paintLand(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const m = canvas.getContext("2d");
  if (m === null) return canvas;
  const rand = mulberry32(5);
  const grad = m.createRadialGradient(140, 118, 25, 150, 150, 150);
  grad.addColorStop(0, "#6a7953");
  grad.addColorStop(1, "#354b38");
  m.fillStyle = grad;
  m.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 150; i += 1) {
    m.fillStyle = i % 2 ? "#485d3b" : "#536340";
    m.beginPath();
    m.ellipse(10 + rand() * 280, 10 + rand() * 280, 4 + rand() * 12, 4 + rand() * 11, rand() * 6, 0, 6.28);
    m.fill();
  }
  m.fillStyle = "#578a84";
  m.beginPath();
  m.ellipse(tx(LAKE.x), tz(LAKE.z), LAKE.rx * S * 0.98, LAKE.rz * S * 0.98, 0, 0, 6.28);
  m.fill();
  m.lineCap = "round";
  m.lineJoin = "round";
  for (const path of PATHS) {
    for (const [width, colour] of [[6, "#aea77b"], [3, "#c4b48a"]] as const) {
      m.strokeStyle = colour;
      m.lineWidth = width;
      m.beginPath();
      path.forEach(([x, z], i) => (i ? m.lineTo(tx(x), tz(z)) : m.moveTo(tx(x), tz(z))));
      m.stroke();
    }
  }
  m.strokeStyle = "#877b52";
  m.lineWidth = 4;
  m.beginPath();
  m.moveTo(tx(BRIDGE.x0), tz(BRIDGE.z));
  m.lineTo(tx(BRIDGE.x1), tz(BRIDGE.z));
  m.stroke();
  m.strokeStyle = "#d2c99f";
  m.lineWidth = 1;
  for (let z = STAIR.z0; z > STAIR.z1; z -= 1.1) {
    m.beginPath();
    m.moveTo(tx(STAIR.x0 + 0.3), tz(z));
    m.lineTo(tx(STAIR.x1 - 0.3), tz(z));
    m.stroke();
  }
  m.fillStyle = "#435c3c";
  m.beginPath();
  m.arc(tx(-9), tz(-20), 13, 0, 6.28);
  m.fill();
  return canvas;
}

/** The overview: the land, the untaken sigils, the keeper, the altar and the hero's arrow. */
export function Minimap({ state }: { state: GameState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const land = useRef<HTMLCanvasElement | null>(null);
  const { playerX, playerZ, playerAngle, mapMarks, stage } = state;
  useEffect(() => {
    const host = ref.current;
    const m = host?.getContext("2d");
    if (host === null || !m) return;
    land.current ??= paintLand();
    m.clearRect(0, 0, SIZE, SIZE);
    m.save();
    m.beginPath();
    m.arc(150, 150, 139, 0, 6.28);
    m.clip();
    m.drawImage(land.current, 0, 0);
    for (let i = 0; i < mapMarks.length; i += 3) {
      m.save();
      m.translate(tx((mapMarks[i] ?? 0) / 10), tz((mapMarks[i + 1] ?? 0) / 10));
      m.rotate(Math.PI / 4);
      m.shadowBlur = 8;
      m.shadowColor = "#d5e5b9";
      m.fillStyle = stage === "meet" ? "#b4ba98" : `#${(mapMarks[i + 2] ?? 0).toString(16).padStart(6, "0")}`;
      m.fillRect(-3, -3, 6, 6);
      m.restore();
    }
    m.fillStyle = "#ead5a0";
    m.beginPath();
    m.arc(tx(KEEPER.x), tz(KEEPER.z), 3.2, 0, 6.28);
    m.fill();
    m.strokeStyle = stage === "altar" ? "#f0e8b9" : "#b2b78e";
    m.lineWidth = 1.5;
    m.beginPath();
    m.arc(tx(ALTAR.x), tz(ALTAR.z), 4.5, 0, 6.28);
    m.stroke();
    m.translate(tx(playerX), tz(playerZ));
    m.rotate(Math.PI - playerAngle);
    m.shadowBlur = 5;
    m.shadowColor = "#0c251c";
    m.fillStyle = "#f3e9bd";
    m.strokeStyle = "#273c2c";
    m.lineWidth = 1.6;
    m.beginPath();
    m.moveTo(0, -7);
    m.lineTo(5.2, 5.2);
    m.lineTo(0, 3);
    m.lineTo(-5.2, 5.2);
    m.closePath();
    m.fill();
    m.stroke();
    m.restore();
  }, [playerX, playerZ, playerAngle, mapMarks, stage]);

  return (
    <section aria-label="Minimap" className="pointer-events-none absolute right-6 bottom-6 flex flex-col items-center">
      <span className="tn-outline -mb-1 text-[10px] text-lume">N</span>
      <canvas className="h-36 w-36 rounded-full ring-2 ring-line/70 shadow-[0_4px_14px_rgb(0_0_0/50%)]" height={SIZE} ref={ref} role="img" width={SIZE} />
      <span className="tn-outline mt-1 text-[9px] tracking-[0.2em] text-dim">THE LOWLANDS</span>
    </section>
  );
}
