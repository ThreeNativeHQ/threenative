import { createDecalFixture } from "./game.js";
const game = createDecalFixture(new URLSearchParams(location.search).get("hideDecals") === "1");
void game
  .start()
  .then(() => {
    const canvas = game.ctx?.renderer.domElement;
    if (canvas === undefined) throw new Error("Decal fixture has no canvas.");
    document.body.append(canvas);
  })
  .catch((error: unknown) => {
    console.error(error);
  });
