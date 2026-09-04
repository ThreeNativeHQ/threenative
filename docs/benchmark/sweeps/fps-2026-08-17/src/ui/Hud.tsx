import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

const KEYS: readonly (readonly [string, string])[] = [
  ["WASD", "Move"],
  ["Mouse 1", "Fire"],
  ["R", "Reload"],
  ["F", "Aim"],
  ["Enter", "Retry"],
];

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 bg-black/45 px-4 py-2 text-[13px] font-semibold tracking-wide">
      {KEYS.map(([key, label], index) => (
        <span className="flex items-center gap-2" key={key}>
          {index > 0 ? <i className="mr-1 not-italic text-white/25">|</i> : null}
          <b className="font-bold text-[#ffa63d]">{key}</b>
          <span className="font-normal text-white/85">{label}</span>
        </span>
      ))}
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const score = useGameState(game, (state) => state.score);
  const health = useGameState(game, (state) => state.health);
  const ammo = useGameState(game, (state) => state.ammo);
  const reserve = useGameState(game, (state) => state.reserve);
  const targetsHit = useGameState(game, (state) => state.targetsHit);
  const timeRemaining = useGameState(game, (state) => state.timeRemaining);
  const hitFlash = useGameState(game, (state) => state.hitFlash);
  const phase = useGameState(game, (state) => state.phase);

  return (
    <div className="pointer-events-none absolute inset-0 select-none font-sans">
      {/* Top left: score over health, flat text, no panel. */}
      <div className="absolute left-4 top-4 leading-tight">
        <div className="text-[21px] font-bold tracking-[0.04em] text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
          SCORE {String(score).padStart(4, "0")}
        </div>
        <div className={`text-[15px] font-bold tracking-[0.04em] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)] transition-colors duration-200 ${health < 35 ? "text-[#ff5f4d]" : "text-[#3ddc6b]"}`}>
          HEALTH {Math.round(health)}
        </div>
      </div>

      {/* Top right: the clock. */}
      <div className="absolute right-4 top-4 text-[21px] font-bold tabular-nums tracking-[0.04em] text-[#ff9b2e] drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
        TIME {Math.ceil(timeRemaining)}
      </div>

      {/* Objective across the top centre. */}
      {phase === "playing" ? (
        <div className="absolute left-0 right-0 top-[86px] text-center text-[15px] font-bold tracking-[0.05em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
          CLICK TO LOCK · HIT {Math.max(0, 12 - targetsHit)} TARGETS
        </div>
      ) : null}

      {/* Magazine and reserve, right of the sights. */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-[21px] font-bold tabular-nums text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
        {ammo} / {reserve}
      </div>

      {/* Crosshair, with a hit marker that blooms outward on a scoring hit. */}
      <div
        className="absolute left-1/2 top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2"
        style={{ transform: `translate(-50%, -50%) scale(${(1 + hitFlash * 0.7).toFixed(3)})` }}
      >
        <i className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-white/90" />
        <i className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-white/90" />
      </div>
      {hitFlash > 0 ? (
        <div
          className="absolute left-1/2 top-1/2 h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2 rotate-45"
          style={{ opacity: Math.min(1, hitFlash * 1.6) }}
        >
          <i className="absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 bg-[#ffd166]" />
          <i className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-[#ffd166]" />
        </div>
      ) : null}
      {health < 45 ? (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 55%, rgba(0,0,0,0) 42%, rgba(190,26,20,0.42) 100%)",
            opacity: Math.min(1, (45 - health) / 30),
          }}
        />
      ) : null}

      {phase !== "playing" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45">
          <div
            className={`text-[42px] font-bold tracking-[0.08em] ${
              phase === "complete" ? "text-[#3ddc6b]" : "text-[#ff5f4d]"
            }`}
          >
            {phase === "complete" ? "RANGE CLEAR" : "RUN OVER"}
          </div>
          <div className="mt-2 text-[18px] font-bold tracking-[0.06em] text-white">
            SCORE {String(score).padStart(4, "0")} · {targetsHit} HITS
          </div>
          <div className="mt-6 text-[15px] font-bold tracking-[0.14em] text-[#ffa63d]">
            PRESS ENTER TO RUN IT AGAIN
          </div>
        </div>
      ) : null}

      <Legend />
    </div>
  );
}
