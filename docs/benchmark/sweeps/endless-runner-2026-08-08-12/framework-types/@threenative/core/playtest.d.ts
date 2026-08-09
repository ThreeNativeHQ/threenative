import { f as GamePluginHooks } from './game-1PR3hzYb.js';
import 'three';
import 'zustand/vanilla';

declare function playtest<TState extends Record<string, unknown> = Record<string, unknown>, TPhysics = undefined>(): GamePluginHooks<TState, TPhysics>;

export { playtest };
