import type { ComponentType, ReactNode } from "react";
import type { GameState } from "../state.js";

export type HudPart =
  | "root"
  | "panel"
  | "scoreLabel"
  | "score"
  | "lives"
  | "life"
  | "meter"
  | "meterHeader"
  | "meterTrack"
  | "meterFill"
  | "banner"
  | "bannerTitle"
  | "bannerHint";

export interface IHudPrimitiveProps {
  readonly active?: boolean;
  readonly children?: ReactNode;
  readonly fill?: number;
  readonly part: HudPart;
  readonly won?: boolean;
}

export interface IHudContentProps {
  readonly Primitive: ComponentType<IHudPrimitiveProps>;
  readonly state: Pick<GameState, "lives" | "playerX" | "score" | "status">;
}

/** One HUD component tree; web and native supply only the primitive that paints each named part. */
export function HudContent({ Primitive, state }: IHudContentProps) {
  const position = Math.abs(state.playerX) * 10;
  const won = state.status === "won";
  return (
    <Primitive part="root">
      <Primitive part="panel">
        <Primitive part="scoreLabel">score</Primitive>
        <Primitive part="score">{state.score}</Primitive>
        <Primitive part="lives">
          lives
          {[0, 1, 2].map((slot) => (
            <Primitive active={slot < state.lives} key={slot} part="life" />
          ))}
        </Primitive>
        <Primitive part="meter">
          <Primitive part="meterHeader">
            position
            {Math.round(position)}
          </Primitive>
          <Primitive part="meterTrack">
            <Primitive fill={Math.max(0, Math.min(100, position))} part="meterFill" />
          </Primitive>
        </Primitive>
      </Primitive>
      {state.status === "playing" ? null : (
        <Primitive part="banner" won={won}>
          <Primitive part="bannerTitle" won={won}>
            {won ? "flag reached" : "out of lives"}
          </Primitive>
          <Primitive part="bannerHint">press r to run it again</Primitive>
        </Primitive>
      )}
    </Primitive>
  );
}
