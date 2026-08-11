import type { IGame } from "@threenative/core";
import { useGameState } from "@threenative/ui";
import type { AbyssState } from "../scenes/Abyss.js";

const PLANKTON = 90_000;
const formatter = new Intl.NumberFormat("en-US");

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] text-dim">{children}</div>;
}

function Meter({ critical = false, fill, label, value }: IMeterProps) {
  return (
    <div className="w-[92px]">
      <div className="flex justify-between gap-2 text-[10px] text-dim">
        <span>{label}</span>
        <b className="font-normal tabular-nums text-text">{value}</b>
      </div>
      <div className="relative mt-[5px] h-1 overflow-hidden border border-line bg-hull">
        <i
          className={`absolute inset-y-0 left-0 ${critical ? "bg-hunter" : fill}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

interface IMeterProps {
  critical?: boolean;
  fill: string;
  label: string;
  value: number;
}

export function Hud({ game }: { game: IGame<AbyssState> }) {
  const { elapsed, energy, fps, hull, hunters, pulsing, score, status } = useGameState(game);
  const depth = 4_180 + Math.floor(elapsed * 7);

  return (
    <div
      className={`pointer-events-none absolute inset-0 grid grid-cols-[auto_1fr_auto] grid-rows-[auto_1fr_auto] gap-3 p-rail text-[11px] uppercase tracking-[0.14em] transition-opacity duration-300 max-[620px]:text-[10px] ${
        status === "play" ? "opacity-100" : "opacity-20"
      }`}
    >
      <div className="col-start-1 row-start-1">
        <Label>
          sector 7 · depth <span>{formatter.format(depth)}</span> m
        </Label>
        <div className="mt-1 text-readout leading-[0.95] tabular-nums text-lamp [text-shadow:0_0_18px_rgb(255_210_122_/_30%)]">
          <span id="score">{formatter.format(score)}</span>
        </div>
        <div className="mt-1.5">
          <Label>pearls recovered</Label>
        </div>
        <div className="mt-3 flex gap-2.5">
          <Meter fill="bg-lamp" label="lamp" value={Math.round(energy)} />
          <Meter
            critical={hull < 34}
            fill="bg-lume"
            label="hull"
            value={Math.max(0, Math.round(hull))}
          />
        </div>
      </div>

      <div className="col-start-3 row-start-1 text-right">
        <Label>dive time</Label>
        <div className="mt-1 text-readout leading-[0.95] tabular-nums text-lume [text-shadow:0_0_18px_rgb(111_232_255_/_35%)]">
          {clock(elapsed)}
        </div>
        <div className="mt-2.5 leading-[1.9] tabular-nums text-dim">
          <div>
            <b className="font-normal text-text">{formatter.format(PLANKTON)}</b> plankton · gpu
            compute
          </div>
          <div>
            <b className="font-normal text-text">{hunters}</b> hunters tracking
          </div>
          <div>
            <b className="font-normal text-text">{Math.round(fps)}</b> fps
          </div>
        </div>
      </div>

      <div className="col-start-1 row-start-3 self-end max-[620px]:hidden">
        <Label>three.js WebGPURenderer · TSL compute · bloom</Label>
      </div>
      <div className="col-start-3 row-start-3 self-end text-right">
        <Label>{pulsing ? "they can see you" : "hold to pulse the lamp"}</Label>
      </div>
    </div>
  );
}
