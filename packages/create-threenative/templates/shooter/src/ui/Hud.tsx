import type { IGame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { useGameState } from "@threenative/ui";
import { shooterUi } from "../render/ui.js";
import type { GameState } from "../state.js";

type MeterTone = keyof typeof shooterUi.hud.meter.fill;

function Meter({ label, value, tone }: { label: string; tone: MeterTone; value: number }) {
  return (
    <div className={shooterUi.hud.meter.root}>
      <div className={shooterUi.hud.meter.label}>
        <span>{label}</span>
        <b className={shooterUi.hud.meter.value}>{Math.round(value)}</b>
      </div>
      <div className={shooterUi.hud.meter.track}>
        <i
          className={shooterUi.hud.meter.fill[tone]}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

export function Hud({ game }: { game: IGame<GameState, IPhysicsContext> }) {
  const health = useGameState(game, (state) => state.health);
  const lives = useGameState(game, (state) => state.lives);
  const wave = useGameState(game, (state) => state.wave);
  const wavesCleared = useGameState(game, (state) => state.wavesCleared);
  const targets = useGameState(game, (state) => state.targetsRemaining);
  const phase = useGameState(game, (state) => state.phase);
  return (
    <section className={shooterUi.hud.root}>
      <div className={shooterUi.hud.eyebrow}>{shooterUi.hud.copy.eyebrow}</div>
      <div className={shooterUi.hud.wave}>{shooterUi.hud.copy.wave(wave)}</div>
      <div className={shooterUi.hud.rules}>{shooterUi.hud.copy.rules}</div>
      <Meter label={shooterUi.hud.copy.health} tone="cyan" value={health} />
      <Meter label={shooterUi.hud.copy.lives} tone="amber" value={(lives / 3) * 100} />
      <div className={shooterUi.hud.summary}>
        <span>{shooterUi.hud.copy.targets(targets)}</span>
        <span>{shooterUi.hud.copy.clear(wavesCleared)}</span>
      </div>
      {phase !== "playing" && (
        <div className={shooterUi.hud.phase[phase]}>{shooterUi.hud.phaseCopy[phase]}</div>
      )}
    </section>
  );
}
