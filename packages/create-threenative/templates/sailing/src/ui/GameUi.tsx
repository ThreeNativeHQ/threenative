import { UiLayer } from "@threenative/ui";
import { Hud } from "./Hud.js";
import { Menu } from "./Menu.js";

export function GameUi() {
  return (
    <UiLayer>
      <Hud />
      <Menu />
    </UiLayer>
  );
}
