import { startFirstProofGame } from '../scenes/shared/first-proof-game.js';

const canvas = globalThis.canvas;
if (!canvas) {
  throw new Error('Android first proof host adapter requires globalThis.canvas');
}

const width = canvas.width || canvas.clientWidth || 1280;
const height = canvas.height || canvas.clientHeight || 720;

globalThis.__TN_ANDROID_FIRST_PROOF_STARTED__ = true;
startFirstProofGame(canvas, { width, height }).then((result) => {
  globalThis.__TN_ANDROID_FIRST_PROOF_READY__ = true;
  globalThis.__TN_ANDROID_FIRST_PROOF_RESULT__ = result;
  console.log('[ThreeNative Android] first proof cube ready');
}).catch((error) => {
  const message = String(error?.stack ? error.stack : error);
  globalThis.__TN_ANDROID_FIRST_PROOF_ERROR__ = message;
  console.error('[ThreeNative Android] first proof failed:', message);
});
