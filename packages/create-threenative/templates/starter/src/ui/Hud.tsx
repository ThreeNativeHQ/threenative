import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";
import { HudContent, type IHudPrimitiveProps } from "./HudContent.js";

function WebHudPrimitive({ active, children, fill, part, won }: IHudPrimitiveProps) {
  switch (part) {
    case "root":
      return children;
    case "panel":
      return <div className="pointer-events-none absolute left-6 top-6 w-32">{children}</div>;
    case "scoreLabel":
      return <div className="text-[10px] uppercase tracking-[0.14em] text-dim">{children}</div>;
    case "score":
      return <div className="text-4xl leading-none tabular-nums text-lume">{children}</div>;
    case "lives":
      return (
        <div className="mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          {children}
        </div>
      );
    case "life":
      return (
        <i className={`h-2 w-2 border border-line ${active === true ? "bg-lume" : "bg-panel"}`} />
      );
    case "meter":
      return <div className="mt-3 w-24">{children}</div>;
    case "meterHeader": {
      const values = Array.isArray(children) ? children : [children];
      return (
        <div className="flex justify-between gap-2 text-[10px] uppercase tracking-[0.14em] text-dim">
          <span>{values[0]}</span>
          <b className="font-normal tabular-nums text-text">{values[1]}</b>
        </div>
      );
    }
    case "meterTrack":
      return (
        <div className="relative mt-1 h-1 overflow-hidden border border-line bg-panel">
          {children}
        </div>
      );
    case "meterFill":
      return <i className="absolute inset-y-0 left-0 bg-lume" style={{ width: `${fill ?? 0}%` }} />;
    case "banner":
      return (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 flex flex-col items-center gap-2">
          {children}
        </div>
      );
    case "bannerTitle":
      return (
        <output
          className={`text-5xl uppercase tracking-[0.2em] ${won === true ? "text-lume" : "text-text"}`}
        >
          {children}
        </output>
      );
    case "bannerHint":
      return <div className="text-[11px] uppercase tracking-[0.14em] text-dim">{children}</div>;
  }
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const lives = useGameState(game, (state) => state.lives);
  const playerX = useGameState(game, (state) => state.playerX);
  const score = useGameState(game, (state) => state.score);
  const status = useGameState(game, (state) => state.status);
  return <HudContent Primitive={WebHudPrimitive} state={{ lives, playerX, score, status }} />;
}
