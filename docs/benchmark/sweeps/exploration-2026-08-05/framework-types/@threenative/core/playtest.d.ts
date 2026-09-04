import { e as GamePluginHooks } from './game-doPK3kcC.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(): GamePluginHooks<TState, TPhysics>;

export { playtest };
