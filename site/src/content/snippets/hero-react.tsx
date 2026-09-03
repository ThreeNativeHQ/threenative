import { GameCanvas, UiLayer, useUiIntent, useUiState } from "@threenative/ui";
import game from "./hero-typescript.js";

function Hud() {
  const score = useUiState<{ score: number }, number>((state) => state.score);
  const send = useUiIntent();
  return (
    <button data-tn-interactive onClick={() => send("restart")} type="button">
      {score ?? 0}
    </button>
  );
}

export function App() {
  return (
    <>
      <GameCanvas game={game} />
      <UiLayer>
        <Hud />
      </UiLayer>
    </>
  );
}
