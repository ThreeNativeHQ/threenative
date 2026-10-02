# native-css-hud

The acceptance fixture for `ui.renderer: "native-css"`: one `src/ui/Inventory.tsx` and one
`src/ui/hud.css`, mounted by react-dom in the browser and by `createCssUiRoot()` on native. The
proof is the HUD, so the scene is a lit spinning cube and nothing else.

- Browser reference: `pnpm --filter threenative-native-css-hud build:web`, then serve `dist/`.
  `reference/hud-chrome-1280x720.png` is that page at 1280x720 in Chromium.
- Desktop playtest: `node packages/playtest/dist/runner/cli.js examples/native-css-hud/playtests/native-css-hud.playtest.json --target desktop --executable <host> --host-arg run --host-arg dist/game.js` (needs a built native host).
- The scenario's click point was measured in Chromium, not guessed: 85.3 x 651 px of 1280x720.
