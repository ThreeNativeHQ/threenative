import { assertCondition, startBehaviorScene } from "./scene-support.js";

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "audio-context", async () => {
    const AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    assertCondition(typeof AudioContextClass === "function", "AudioContext must exist");
    const context = new AudioContextClass();
    assertCondition(typeof context.createGain === "function", "AudioContext.createGain must exist");
    const gain = context.createGain();
    assertCondition(typeof gain.connect === "function", "GainNode.connect must exist");
    gain.connect(context.destination);
    if (typeof context.close === "function") await context.close();
    return { gainNode: true };
  });
}
