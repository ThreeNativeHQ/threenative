import { useUiIntent, useUiState } from "@threenative/ui";
import { useState } from "react";
import type { GameState } from "../state.js";

/**
 * A form belongs in the shared React UI. Only its submitted value crosses the game/UI boundary;
 * game.ts validates it and carries the accepted name into the play scene.
 */
export function MainMenuUi() {
  const send = useUiIntent();
  const screen = useUiState<GameState, GameState["screen"]>((state) => state.screen);
  const [name, setName] = useState("");
  if (screen !== "menu") return null;

  return (
    <section className="absolute inset-0 flex flex-col items-center justify-center gap-6">
      <h1 className="text-5xl font-bold tracking-[0.2em] text-text drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">
        THREE NATIVE
      </h1>
      <form
        className="flex flex-col items-center gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          send("start-game", { name });
        }}
      >
        <input
          className="pointer-events-auto w-56 border border-line bg-panel/80 px-3 py-2 text-center text-sm text-text placeholder:text-dim focus:border-lume focus:outline-none"
          data-tn-interactive
          maxLength={24}
          onChange={(event) => setName(event.target.value)}
          placeholder="character name"
          type="text"
          value={name}
        />
        <button
          className="pointer-events-auto border border-line px-6 py-2 text-sm uppercase tracking-[0.14em] text-text hover:border-lume disabled:opacity-40"
          data-tn-interactive
          disabled={name.trim().length === 0}
          type="submit"
        >
          begin
        </button>
      </form>
    </section>
  );
}
