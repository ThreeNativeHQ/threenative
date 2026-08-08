export type MissionState = "active" | "won";

/** Owns the arena's natural lifecycle so the playtest can observe it. */
export class Mission {
  #state: MissionState = "active";

  get state(): MissionState {
    return this.#state;
  }

  update(enemiesRemaining: number): void {
    if (enemiesRemaining <= 0) this.#state = "won";
  }

  debug(): { active: boolean; state: MissionState; won: boolean } {
    return {
      active: this.#state === "active",
      state: this.#state,
      won: this.#state === "won",
    };
  }

  dispose(): void {
    // Mission has no scene object; the entity registry still expects a disposal hook.
  }
}
