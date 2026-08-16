import { JsonValue } from '@threenative/playtest';
import { c as IGamePluginHooks } from './game-T412_CJx.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(options?: IPlaytestOptions): IGamePluginHooks<TState, TPhysics>;
declare const PLAYTEST_ATTACH_TIMEOUT_MS = 30000;
interface IPlaytestOptions {
    readonly events?: () => JsonValue[];
    /**
     * Hold the frame loop until a runner attaches. Default false.
     */
    readonly holdUntilAttached?: boolean;
    /** Milliseconds to wait when `holdUntilAttached` is set. Default {@link PLAYTEST_ATTACH_TIMEOUT_MS}. */
    readonly attachTimeoutMs?: number;
}

export { type IPlaytestOptions, PLAYTEST_ATTACH_TIMEOUT_MS, playtest };
