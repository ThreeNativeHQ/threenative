import { a as audioRuntimeSnapshot } from './audio-CEAw0w5y.js';
import { I as IGame } from './game-BJb_vq-9.js';
import 'three';
import 'zustand/vanilla';

interface IHotDiagnostics {
    readonly reloads: number;
    readonly entities: number;
    readonly sceneObjects: number;
    readonly canvases: number;
    readonly audio: ReturnType<typeof audioRuntimeSnapshot>;
    readonly physics: number | null;
}
declare function assertPortableState(state: unknown): void;
declare function acceptHotUpdate<TState extends Record<string, unknown>, TPhysics>(game: IGame<TState, TPhysics>, hot: IImportMeta["hot"]): void;
interface IImportMeta {
    readonly env?: {
        readonly DEV?: boolean;
    };
    readonly hot?: IViteHotContext;
}
interface IViteHotContext {
    readonly data: Record<string, unknown>;
    accept(): void;
    dispose(callback: (data: Record<string, unknown>) => void): void;
    invalidate(message?: string): void;
}

export { type IHotDiagnostics, acceptHotUpdate, assertPortableState };
