import { Scene } from "@threenative/core";
import type { GameCtx, GameState } from "./Play.js";

export class Boot extends Scene<GameState, GameCtx["physics"]> {}
