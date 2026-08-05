import type { Game } from "@threenative/core";
import type { PhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import type { GameState } from "../state.js";

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="hud-bar">
      <div className="hud-bar__label"><span>{label}</span><b>{Math.round(value)}</b></div>
      <div className="hud-bar__track"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
    </div>
  );
}

export function Hud({ game }: { game: Game<GameState, PhysicsContext> }) {
  const health = useGameState(game, (state) => state.health);
  const ammo = useGameState(game, (state) => state.ammo);
  const cooldown = useGameState(game, (state) => state.cooldown);
  const enemiesRemaining = useGameState(game, (state) => state.enemiesRemaining);
  const objective = useGameState(game, (state) => state.objective);
  const pickups = useGameState(game, (state) => state.pickups);
  const score = useGameState(game, (state) => state.score);
  const shots = useGameState(game, (state) => state.shots);
  const won = useGameState(game, (state) => state.won);
  const ready = cooldown <= 0.01 && ammo > 0;

  return (
    <div className="pointer-events-none absolute inset-0">
      <header className="hud-header">
        <div><div className="hud-kicker">NIGHT SHIFT // SECTOR 07</div><h1>NEON SWEEP</h1></div>
        <div className="hud-status"><span className={won ? "status-dot status-dot--gold" : "status-dot"} />{won ? "SECURE" : "LIVE"}</div>
      </header>
      <section className="hud-objective">
        <div className="hud-kicker">CURRENT OBJECTIVE</div>
        <div className={won ? "hud-objective__title hud-objective__title--won" : "hud-objective__title"}>{objective}</div>
        <div className="hud-objective__sub">{won ? "ALL HOSTILES NEUTRALIZED" : `${enemiesRemaining} TARGETS REMAINING`}</div>
      </section>
      <section className="hud-stats">
        <div className="hud-score"><span className="hud-kicker">SCORE</span><strong>{score.toString().padStart(2, "0")}</strong><span className="hud-score__shots">{shots} SHOTS</span></div>
        <div className="hud-targets"><span className="hud-kicker">HOSTILES</span><strong>{enemiesRemaining}<small> / 3</small></strong></div>
      </section>
      <section className="hud-loadout">
        <Bar label="HULL" value={health} />
        <div className="hud-ammo"><div className="hud-bar__label"><span>CHARGE</span><b>{ready ? "READY" : cooldown > 0.8 ? "RELOADING" : "COOLDOWN"}</b></div><div className="ammo-pips">{Array.from({ length: 6 }, (_, index) => <i className={index < ammo ? "ammo-pip ammo-pip--on" : "ammo-pip"} key={index} />)}</div></div>
        <div className="hud-pickup">SALVAGE <b>+{pickups * 20}</b></div>
      </section>
      {won && <div className="win-card"><div className="hud-kicker">MISSION COMPLETE</div><div>SECTOR CLEAR</div><small>PRESS R TO RUN ANOTHER SWEEP</small></div>}
    </div>
  );
}
