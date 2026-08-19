## Budget real time for the look

Read this as an instruction about **where your effort goes**, not as a style tip.

Every automated gate in this project — `typecheck`, `lint`, `pnpm test`, every playtest
scenario — is blind to how the game looks. All of them pass on a game that is grey boxes on
a black screen. If you let the gates define "done", you will ship grey boxes on a black
screen and the gates will tell you that you succeeded.

So the rule here is: **a feature is not done when its assertion passes. It is done when you
have looked at it and it reads well.** Plan for roughly as much work on presentation as on
mechanics. That is not gold-plating; it is the majority of what a player experiences, and
it is the part nothing else in this repo will catch.

Concretely, when you add anything a player sees, do all of these before calling it done:

1. **Look at it.** Boot the game, get the thing on screen, take a screenshot, open the
   screenshot. Reading your own diff is not looking at it.
2. **Silhouette first.** Can you tell what it is from its outline alone? Break up long
   straight edges — overhangs, fringes, props crossing the line. A shape that reads at a
   glance beats a detailed shape that does not.
3. **Give it depth.** Something bright behind it, something dark under it. Contact shadows
   and a rim make a prop sit in the world instead of floating on top of it.
4. **Make it move.** Idle bob, a squash on impact, a particle on pickup, a screen shake on
   damage. A few frames of motion is the cheapest quality-per-line in the whole project.
5. **Finish the HUD too.** Spacing, hierarchy, a transition on every number that changes.
   An unstyled HUD makes a good-looking game look unfinished.

### How to actually look at it

Run `pnpm dev`, then get eyes on it. In rough order of preference:

1. **Browser automation against the user's real Chrome**, if you have it — Claude in Chrome
   or any equivalent MCP browser tool. This is the best option by a wide margin: it runs on
   a real GPU, so WebGPU works, and you can navigate, press keys, screenshot, and read the
   console in the same loop you are already coding in. Drive the game, do not just load the
   menu.
2. **`npx @threenative/playtest <scenario> --browser-recipe webgpu --headed`.** The recipe
   carries the Chromium flags a WebGPU capture needs, including `--enable-features=Vulkan`.
   Do not hand-roll the flag list: without that one flag Chromium never reaches the Linux
   Vulkan driver and serves WebGPU from SwiftShader, its CPU rasteriser — no error, healthy
   limits, and a software renderer's picture. The runner now fails such a run with
   `TN_PLAYTEST_SOFTWARE_ADAPTER` and prints the adapter it got; `--allow-software` accepts
   the fallback if you truly want it.
3. **Ask the user to look**, and say specifically what you want them to check.

On a machine with no screen, run any of those under a virtual display. **Do not use
`xvfb-run`:** on `xorg-server-xvfb` 21.1.x its cleanup `kill` fails after Xvfb has already
exited and that failing kill's status replaces the real one, so
`xvfb-run -a -s '-screen 0 1600x900x24' true` exits `1`. Every gate wrapped in it reports
failure whether it passed or not. Start `Xvfb` yourself on a free display and export
`DISPLAY`, or check the command's own exit code separately.

What does *not* work: **headless Chromium usually cannot render WebGPU.** The page loads,
the HUD paints, and the 3D canvas comes out blank or black. That looks exactly like a bug
in your scene, and it is not. Symptoms are `Instance dropped in popErrorScope` and
`createBuffer failed, size (N) is too large for the implementation` in the console.

So: if a screenshot comes back black or empty, suspect the capture before you rewrite the
scene. Confirm the renderer works at all before you go debugging your materials.

### When you think you are done

Ask yourself, honestly: *would a player screenshot this?* If the answer is no, you are not
finished — and no command in this repo is going to tell you that.
