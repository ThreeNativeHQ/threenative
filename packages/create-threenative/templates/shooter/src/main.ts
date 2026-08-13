import { acceptHotUpdate } from "@threenative/core/hot";
import { createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import game from "./game.js";
import { App } from "./ui/App.js";
import "./render/ui.css";

function WebApp({ game: currentGame }: { game: typeof game }) {
  const [paused, setPaused] = useState(false);
  const onTogglePause = () => {
    if (paused) currentGame.resume();
    else currentGame.pause();
    setPaused((value) => !value);
  };
  const onRestart = () => void currentGame.goto("play");
  return createElement(App, { game: currentGame, onRestart, onTogglePause, paused });
}

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element.");
const appRoot = root as typeof root & { __threenativeRoot?: ReturnType<typeof createRoot> };
const reactRoot = appRoot.__threenativeRoot ?? createRoot(appRoot);
appRoot.__threenativeRoot = reactRoot;
reactRoot.render(createElement(WebApp, { game }));
