import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const area = useGameState(game, (state) => state.area);
  const areaLabel = useGameState(game, (state) => state.areaLabel);
  const inspectedPoints = useGameState(game, (state) => state.inspectedPoints.join("|"));
  const inspections = useGameState(game, (state) => state.inspections);
  const lastMessage = useGameState(game, (state) => state.lastMessage);
  const objectiveComplete = useGameState(game, (state) => state.objectiveComplete);
  const points = inspectedPoints.length === 0 ? [] : inspectedPoints.split("|");
  return (
    <div className="pointer-events-none absolute inset-0 p-5 sm:p-7">
      <section className="hud-panel w-[min(19rem,calc(100vw-2.5rem))] p-4" data-testid="journal-panel">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="eyebrow">field journal / 01</div>
            <h1 className="mt-1 text-lg font-medium tracking-tight text-bright">Trace the quiet signal</h1>
          </div>
          <div className="area-mark" aria-label={`current area: ${area}`}>{area === "hub" ? "H" : area === "north" ? "N" : "S"}</div>
        </div>
        <div className="mt-4 border-t border-line/70 pt-3">
          <div className="eyebrow">current location</div>
          <div className="mt-1 text-sm text-lume">{areaLabel}</div>
        </div>
        <div className="mt-4 border-t border-line/70 pt-3">
          <div className="flex items-center justify-between">
            <span className="eyebrow">memory stones</span>
            <span className="tabular-nums text-sm text-bright">{inspections}/3</span>
          </div>
          <div className="mt-2 flex gap-2" aria-label={`${inspections} of 3 points inspected`}>
            {["hub.waystone", "north.archive", "south.tide"].map((id) => (
              <i className={`journal-dot ${points.includes(id) ? "is-found" : ""}`} key={id} />
            ))}
          </div>
          <div className="mt-3 text-xs leading-relaxed text-text">
            {objectiveComplete ? "The route is complete. The signal has a shape now." : "Inspect each stone with E, then return to the hub."}
          </div>
        </div>
      </section>

      <div className="pointer-events-none absolute bottom-24 left-1/2 w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 text-center" data-testid="message-line">
        <div className="message-line">{lastMessage}</div>
      </div>

      <div className="absolute right-5 top-5 text-right sm:right-7 sm:top-7">
        <div className="eyebrow">expedition status</div>
        <div className="mt-1 text-xs text-text">{objectiveComplete ? "signal mapped" : "signal unresolved"}</div>
      </div>
    </div>
  );
}
