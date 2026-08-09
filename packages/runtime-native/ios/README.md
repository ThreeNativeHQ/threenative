# iOS host

`threenative-ios` is a root-linked simulator/device app around the exact import-free
`examples/native-smoke/dist/native-smoke.js` proof used by desktop and Android. It does not
own a renderer or a second scenario format.

Build and execute the simulator gate on an Apple Silicon macOS host with Xcode installed:

```sh
node packages/runtime-native/scripts/verify-ios-simulator.mjs
```

The gate builds the shared bundle, downloads untracked SDL3/wgpu-native inputs, builds the
app, boots and installs it with `simctl`, checks unified logs for all 300-frame markers, and
writes a screenshot and JSON report under ignored `artifacts/ios/`. It then runs the unchanged
device scenario plus wrong-value, missing-bridge, misspelled-key, and unsupported-network
controls through the operator CLI. Physical-device playtest launch uses
`threenative-playtest --target ios --ios-transport device --device <id>` and `devicectl`; it
still requires a signed device build.
