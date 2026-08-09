import { Object3D, PerspectiveCamera } from "three";
import { AudioBus } from "../../core/src/audio.ts";

declare const process: { exit(code: number): never };

const camera = new PerspectiveCamera();
const bus = new AudioBus({ camera });
await bus.unlock();
const context = bus.listener.context;
const buffer = context.createBuffer(1, 256, context.sampleRate);
buffer.getChannelData(0).fill(1);
const source = new Object3D();
source.position.set(10, 0, 0);
const voice = bus.playAt(buffer, source, { fade: 0.01, volume: 0.5 });
source.updateMatrixWorld(true);
voice.updateMatrixWorld(true);

if (typeof context.createPanner !== "function") throw new Error("createPanner is missing.");
if (voice.parent !== source) throw new Error("playAt did not attach to its source.");
if (voice.getRefDistance() !== 1) throw new Error("playAt did not configure refDistance.");
if (bus.voices !== 1) throw new Error("AudioBus did not register the playing voice.");

setTimeout(() => {
  if (bus.voices !== 0) {
    console.error(`AudioBus retained ${bus.voices} ended voice(s).`);
    process.exit(1);
  }
  console.info("TN_NATIVE_AUDIO_PLAY_AT_OK:createPanner+gain+source+ended");
  bus.dispose();
  process.exit(0);
}, 100);
