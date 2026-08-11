import { a as audioRuntimeSnapshot } from './audio-3vkjtiuo.js';
import { G as Game } from './game-B__IjREg.js';
import 'three';
import 'zustand/vanilla';

interface HotDiagnostics {
    readonly reloads: number;
    readonly entities: number;
    readonly sceneObjects: number;
    readonly canvases: number;
    readonly audio: ReturnType<typeof audioRuntimeSnapshot>;
    readonly physics: number | null;
}
declare function assertPortableState(state: unknown): void;
declare function acceptHotUpdate<TState extends Record<string, unknown>, TPhysics>(game: Game<TState, TPhysics>, hot: ImportMeta["hot"]): void;

export { type HotDiagnostics, acceptHotUpdate, assertPortableState };
