# PRD-317 cross-target evidence — 2026-09-02

The same clean-install generated starter was used for both browser and packed Linux desktop:

    /tmp/threenative-starter-A8CR3I/starter

The generated project was scaffolded and installed by scripts/verify-one-template.ts. The native
desktop binary used the locally built runtime because the registry's v0.3.0 Linux prebuilt was not
available in this environment.

## Browser WebGPU

Exact command and server command:

~~~sh
sh /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901/scripts/xvfb.sh node node_modules/@threenative/playtest/dist/runner/cli.js --scenario playtests/look.playtest.json --target browser --browser-recipe webgpu --headed --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort' --project . --artifacts artifacts/prd-317-web-look --timeout 30000
~~~

Raw runner observations:

~~~text
"rendererKind":"webgpu","target":"web"
"vendor":"nvidia","architecture":"turing"
"state":{"before":"refined","after":"refined"}
"generation":{"before":1,"after":1}
"positionHash":{"before":"281e3f29","after":"281e3f29"}
"indexHash":{"before":"4ebe619a","after":"4ebe619a"}
"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":22979.493467098077,"windingConflicts":0
"triangles":1040,"vertices":522,"cellSize":8
"pass":true
"artifactDirectory":"/tmp/threenative-starter-A8CR3I/starter/artifacts/prd-317-web-look"
~~~

The browser adapter arguments in the raw capture were:

~~~text
--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist --enable-features=Vulkan
~~~

The starter look run also observed player movement distance 7.300230508684106 and no console,
network or runtime diagnostics. The ridge-region visual assertion observed nonblank ratio
0.9898611111111111 and dark-pixel ratio 0.9794455295138889.

## Linux desktop

The native runtime was built in-repository:

~~~sh
pnpm native:build
~~~

~~~text
[405/405] Linking CXX executable tn-linux/mystral
~~~

The generated project was packed with:

~~~sh
THREENATIVE_RUNTIME_BINARY=/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901/packages/runtime-native/build/tn-linux/mystral pnpm build:desktop
~~~

The exact native playtest command was:

~~~sh
SDL_AUDIODRIVER=dummy sh /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901/scripts/xvfb.sh node node_modules/@threenative/playtest/dist/runner/cli.js --scenario native-playtests/render-chain.playtest.json --target desktop --executable dist-native/starter --project . --artifacts artifacts/prd-317-native-render-chain-dummy-audio --timeout 30000
~~~

Raw native observations:

~~~text
"runtime":"native","target":"desktop"
"state":{"before":"refined","after":"refined"}
"generation":{"before":1,"after":1}
"positionHash":{"before":"281e3f29","after":"281e3f29"}
"indexHash":{"before":"4ebe619a","after":"4ebe619a"}
"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":22979.493467098077,"windingConflicts":0
"triangles":1040,"vertices":522,"buildMs":28,"cellSize":8
"renderChain":{"tier":"high"}
"pass":true
"artifactDirectory":"/tmp/threenative-starter-A8CR3I/starter/artifacts/prd-317-native-render-chain-dummy-audio"
~~~

The native console identified NVIDIA GeForce RTX 2080, vendor nvidia, backend Vulkan, and V8
13.1.201.22. The saved native screenshot was
/tmp/threenative-starter-A8CR3I/starter/artifacts/prd-317-native-render-chain-dummy-audio/after.png;
it was inspected and showed the connected dark fused ridge with no blank frame.

The first native invocation without SDL_AUDIODRIVER=dummy was red only because the host audio
device was unavailable:

~~~text
[Audio] Failed to open audio device: ALSA: Couldn't open audio device: Host is down
exit 1
~~~

Re-running with the dummy audio driver passed with zero diagnostics, so the audio repair is
environment setup rather than a feature fallback.

## Native Worker negative control

The generated packed source was temporarily changed to omit:

~~~text
dispatch(initialSeed, REFINED_SETTINGS);
~~~

The same native scenario then returned:

~~~text
"state":{"before":"preview","after":"preview"}
"generation":{"before":0,"after":0}
"positionHash":{"before":"43080430","after":"43080430"}
"indexHash":{"before":"3a4c7c4b","after":"3a4c7c4b"}
"pass":false
exit 1
~~~

The temporary source was restored to the dispatch shown above.

## Live-source removal negative control

Changing the live scenery import to ./rockRidge.missing.js and running the real generated
scaffold/build harness produced:

~~~sh
pnpm exec tsx scripts/verify-one-template.ts starter
~~~

~~~text
Build failed with 1 error:
[UNRESOLVED_IMPORT] Could not resolve './rockRidge.missing.js' in src/render/scenery.ts
Help: 'src/render/scenery.ts' is imported by:
  - src/scenes/Play.ts
  - src/game.ts
  - src/main.ts
exit 1
~~~

The scenery import was restored before the final gates.

Android and iOS were not executed for this lane and remain UNVERIFIED.
