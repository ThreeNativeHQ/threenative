import { JsonValue } from '@threenative/playtest';
import { b as GamePluginHooks } from './game-DRPs3M7r.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(options?: PlaytestOptions): GamePluginHooks<TState, TPhysics>;
interface PlaytestOptions {
    readonly events?: () => JsonValue[];
}

export { type PlaytestOptions, playtest };
