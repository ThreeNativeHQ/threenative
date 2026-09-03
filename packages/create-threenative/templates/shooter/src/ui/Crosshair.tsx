import { useUiState } from "@threenative/ui";
import { shooterUi } from "../render/ui.js";
import type { GameState } from "../state.js";

/**
 * The reticle.
 *
 * Two bars with a gap, not a dot: the gap is where the round goes, and it is the only part of a
 * first-person HUD the player actually looks at. It disappears down the sights, because the optic
 * on the weapon is the sight at that point and two reticles read as a bug.
 *
 * It is DOM rather than a mesh because it must sit at the exact centre of the *window*, which is
 * where a viewport-space element already is. A world-space quad in front of the camera moves with
 * the field of view and drifts off centre the moment ADS changes it.
 */
export function Crosshair() {
  const state = useUiState<GameState>();
  if (state === undefined || state.phase !== "playing") return null;
  return (
    <div className={state.aiming === 1 ? shooterUi.crosshair.rootAiming : shooterUi.crosshair.root}>
      <i className={shooterUi.crosshair.vertical} />
      <i className={shooterUi.crosshair.horizontal} />
    </div>
  );
}
