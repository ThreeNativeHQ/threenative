import * as react_jsx_runtime from 'react/jsx-runtime';
import { IGame } from '@threenative/core';

interface IGameCanvasProps<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    className?: string;
    game: IGame<TState, TPhysics>;
}
declare function GameCanvas<TState extends Record<string, unknown>, TPhysics>({ className, game, }: IGameCanvasProps<TState, TPhysics>): react_jsx_runtime.JSX.Element;

declare function DebugOverlay(): react_jsx_runtime.JSX.Element | null;

type GameSelector<TState, TSelected> = (state: TState) => TSelected;
declare function useGameState<TState extends Record<string, unknown>, TPhysics, TSelected>(game: IGame<TState, TPhysics>, selector: GameSelector<TState, TSelected>): TSelected;
declare function useGameState<TState extends Record<string, unknown>, TPhysics>(game: IGame<TState, TPhysics>): TState;

export { DebugOverlay, GameCanvas, useGameState };
