import type { Game } from "@threenative/core";
import { useSyncExternalStore } from "react";

type GameSelector<TState, TSelected> = (state: TState) => TSelected;

export function useGameState<TState extends Record<string, unknown>, TPhysics, TSelected>(
  game: Game<TState, TPhysics>,
  selector: GameSelector<TState, TSelected>,
): TSelected;
export function useGameState<TState extends Record<string, unknown>, TPhysics>(
  game: Game<TState, TPhysics>,
): TState;
export function useGameState<TState extends Record<string, unknown>, TPhysics, TSelected = TState>(
  game: Game<TState, TPhysics>,
  selector: GameSelector<TState, TSelected> = (state) => state as unknown as TSelected,
): TSelected {
  return useSyncExternalStore(
    (onStoreChange) => game.state.subscribe(onStoreChange),
    () => selector(game.state.getState()),
    () => selector(game.state.getState()),
  );
}
