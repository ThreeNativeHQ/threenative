import game from "./game.js";
import { BIOMES, type WorldName } from "./render/biomes.js";

const world = new URLSearchParams(location.search).get("world");
if (world && Object.hasOwn(BIOMES, world)) game.resumeScene(world as WorldName);
void game.start().then(() => {
  game.state.setState({ showcase: new URLSearchParams(location.search).has("showcase") });
});
