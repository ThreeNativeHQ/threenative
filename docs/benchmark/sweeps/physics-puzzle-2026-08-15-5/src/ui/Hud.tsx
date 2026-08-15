import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-[10px] uppercase tracking-[0.18em] text-dim">{label}</span>
      <b className="font-normal tabular-nums text-text">{value}</b>
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const crates = useGameState(game, (state) => state.crates);
  const settled = useGameState(game, (state) => state.settled);
  const contacts = useGameState(game, (state) => state.contacts);
  const shifted = useGameState(game, (state) => state.shifted);
  const goal = useGameState(game, (state) => state.goal);
  const passes = useGameState(game, (state) => state.phantomPasses);
  const runs = useGameState(game, (state) => state.runs);
  const checked = useGameState(game, (state) => state.replayChecked);
  const match = useGameState(game, (state) => state.replayMatch);
  const hash = useGameState(game, (state) => state.simHash);
  const rest = useGameState(game, (state) => state.restMatch);
  const restHash = useGameState(game, (state) => state.restHash);

  return (
    <div className="pointer-events-none absolute left-6 top-6 w-72 border border-line bg-panel/70 px-4 py-3 backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-[0.22em] text-dim">crate vault</div>
      <div
        className={`mt-1 text-2xl leading-none ${goal ? "text-lume" : "text-text"}`}
        data-testid="goal"
      >
        {goal ? "VAULT OPEN" : "VAULT SEALED"}
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <Readout label="bodies" value={`${crates}`} />
        <Readout label="at rest" value={`${settled} / ${crates}`} />
        <Readout label="crates shoved" value={`${shifted}`} />
        <Readout label="goal contacts" value={`${contacts}`} />
        <Readout label="phantom passes" value={`${passes}`} />
        <Readout label="run" value={`${runs}`} />
        <Readout
          label="replay"
          value={checked === 0 ? "run 1 — recording" : match ? `match ×${checked}` : "DIVERGED"}
        />
        <Readout label="settled state" value={rest} />
        <Readout label="rest hash" value={restHash || "—"} />
        <Readout label="sim hash" value={hash || "—"} />
      </div>
    </div>
  );
}
