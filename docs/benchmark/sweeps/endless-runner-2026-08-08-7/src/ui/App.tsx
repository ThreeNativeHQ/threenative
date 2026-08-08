import type { Game } from "@threenative/core";
import { GameCanvas } from "@threenative/ui";
import { useEffect, useRef } from "react";
import type { GameState } from "../state.js";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

export function App({ game }: { game: Game<GameState> }) {
  const shell = useRef<HTMLElement>(null);

  useEffect(() => {
    shell.current?.focus();
    const keepGameKeysLocal = (event: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(event.code)) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", keepGameKeysLocal, { passive: false });
    return () => window.removeEventListener("keydown", keepGameKeysLocal);
  }, []);

  return (
    <main
      ref={shell}
      aria-label="Endless runner game"
      className="game-shell relative h-screen w-screen overflow-hidden bg-sky outline-none"
      onPointerDown={() => shell.current?.focus()}
      tabIndex={-1}
    >
      <GameCanvas className="absolute inset-0" game={game} />
      <Hud game={game} />
      <Menu game={game} />
    </main>
  );
}
