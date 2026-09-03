import { useUiState } from "@threenative/ui";
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

export function Hud() {
  const state = useUiState<GameState>();
  // Nothing to draw until the game publishes its first snapshot, a few milliseconds in. Rendering
  // zeroes instead would put wrong numbers on screen and then correct them.
  if (state === undefined) return null;
  const { ammo, health, lives, reloading, reserve, wave, wavesCleared, phase } = state;
  const targets = state.targetsRemaining;
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
      <div className={shooterUi.hud.ammo.root}>
        <b className={shooterUi.hud.ammo.count}>{shooterUi.hud.copy.ammo(ammo, reserve)}</b>
        {reloading === 1 && (
          <span className={shooterUi.hud.ammo.reloading}>{shooterUi.hud.copy.reloading}</span>
        )}
      </div>
      {phase !== "playing" && (
        <div className={shooterUi.hud.phase[phase]}>{shooterUi.hud.phaseCopy[phase]}</div>
      )}
    </section>
  );
}
