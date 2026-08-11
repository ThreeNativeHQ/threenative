import { JsonValue } from '@threenative/playtest';
import { b as GamePluginHooks } from './game-B__IjREg.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(options?: PlaytestOptions): GamePluginHooks<TState, TPhysics>;
declare const PLAYTEST_ATTACH_TIMEOUT_MS = 30000;
interface PlaytestOptions {
    readonly events?: () => JsonValue[];
    /**
     * Hold the frame loop until a runner attaches. Default false.
     */
    readonly holdUntilAttached?: boolean;
    /** Milliseconds to wait when `holdUntilAttached` is set. Default {@link PLAYTEST_ATTACH_TIMEOUT_MS}. */
    readonly attachTimeoutMs?: number;
}

export { PLAYTEST_ATTACH_TIMEOUT_MS, type PlaytestOptions, playtest };
