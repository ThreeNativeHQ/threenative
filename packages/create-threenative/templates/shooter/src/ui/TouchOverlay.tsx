import { TouchControls } from "../entities/TouchControls.js";

/**
 * The visible half of the thumb controls.
 *
 * Purely decorative: every element is `pointer-events-none`, because the input itself is read from
 * `ctx.input.raw.pointers` inside the scene. If these divs swallowed touches the game would stop
 * responding exactly where the controls are drawn, which is the failure mode worth designing out.
 *
 * The circles are positioned from `TouchControls.buttons`, the same array the hit test uses, so a
 * button can never drift from the region that activates it — the classic mobile-controls bug where
 * the art and the hitbox disagree by twenty pixels and the player is simply told they missed.
 *
 * Shown only under `@media (pointer: coarse)` (see `style.css`), so a desktop mouse never sees it.
 */

const GLYPHS: Record<string, string> = {
  fire: "FIRE",
  aim: "ADS",
  reload: "R",
  crouch: "CR",
};

export function TouchOverlay() {
  return (
    <div className="touch-only pointer-events-none absolute inset-0 select-none">
      {/* Left band hint. The real stick floats to wherever the thumb lands, so this is a
          resting place rather than a target — drawing a fixed stick would lie about that. */}
      <div
        className="stick-hint absolute rounded-full border-2 border-white/20"
        style={{ bottom: 96, height: 148, left: 40, width: 148 }}
      >
        <div className="absolute inset-0 grid place-items-center text-[11px] font-bold tracking-widest text-white/35">
          MOVE
        </div>
      </div>

      {TouchControls.buttons.map((button) => (
        <div
          className="absolute grid place-items-center rounded-full border-2 border-white/30 bg-black/30 text-[12px] font-bold tracking-wider text-white/70"
          key={button.action}
          style={{
            bottom: button.bottom - button.radius,
            height: button.radius * 2,
            right: button.right - button.radius,
            width: button.radius * 2,
          }}
        >
          {GLYPHS[button.action]}
        </div>
      ))}
    </div>
  );
}
