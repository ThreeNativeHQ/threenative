import * as react_jsx_runtime from 'react/jsx-runtime';
import { Game } from '@threenative/core';

interface GameCanvasProps<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined> {
    className?: string;
    game: Game<TState, TPhysics>;
}
declare function GameCanvas<TState extends Record<string, unknown>, TPhysics>({ className, game, }: GameCanvasProps<TState, TPhysics>): react_jsx_runtime.JSX.Element;

type DebugSnapshot = Record<string, Record<string, unknown>>;
declare function DebugOverlay(): react_jsx_runtime.JSX.Element | null;

type GameSelector<TState, TSelected> = (state: TState) => TSelected;
declare function useGameState<TState extends Record<string, unknown>, TPhysics, TSelected>(game: Game<TState, TPhysics>, selector: GameSelector<TState, TSelected>): TSelected;
declare function useGameState<TState extends Record<string, unknown>, TPhysics>(game: Game<TState, TPhysics>): TState;

export { DebugOverlay, type DebugSnapshot, GameCanvas, type GameCanvasProps, useGameState };
