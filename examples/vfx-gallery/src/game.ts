import { defineGame } from "@threenative/core";
import { playtest } from "@threenative/core/playtest";
import config from "../threenative.config.js";
import { Gallery, drainGalleryEvents } from "./scenes/Gallery.js";
import type { GalleryState } from "./scenes/Gallery.js";

const game = defineGame<GalleryState>({
  camera: { far: 100, near: 0.1, projection: "perspective", fov: 60 },
  container:
    typeof document === "undefined" ? undefined : (document.getElementById("app") ?? undefined),
  input: { nextPage: { keys: ["KeyN"] } },
  plugins: [playtest({ events: drainGalleryEvents })],
  display: config.display,
  render: config.renderer,
  scenes: { gallery: Gallery },
  seed: 316,
  start: "gallery",
});

export default game;
